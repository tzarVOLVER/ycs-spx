'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const { PublicSheets, normalizeSettings } = require('./public-sheets.cjs');
const clone = value => structuredClone(value);
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 300; }
function linkable(item, field) { return item.ycsSlot === 'ticker' && field === 'f5' && item.DataFields.some(definition => definition.field === field && definition.ftype === 'textfield'); }

function validate(document) {
  if (!document || document.version !== 1 || !Number.isSafeInteger(document.revision) || document.revision < 0 || !document.sources || Array.isArray(document.sources) || !Array.isArray(document.mappings)) fail('Invalid local data document');
  if (Object.keys(document.sources).length > 100 || document.mappings.length > 300) fail('Too many data sources or mappings');
  for (const [id, source] of Object.entries(document.sources)) {
    if (!keyPattern.test(id) || !source || !text(source.label)) fail('Source labels must be nonempty text, up to 300 characters');
    if (source.type === 'google-sheets') {
      const settings = normalizeSettings(source.settings);
      if (!settings.cell) fail('Google Sheets sources require a selected cell');
      if (JSON.stringify(settings) !== JSON.stringify(source.settings)) fail('Invalid Google Sheets source configuration');
    } else if ((source.type && source.type !== 'local') || !text(source.value)) fail('Local source values must be nonempty text, up to 300 characters');
  }
  const seen = new Set();
  for (const mapping of document.mappings) {
    if (!mapping || !['stage', 'graphic', 'field', 'source'].every(key => typeof mapping[key] === 'string' && keyPattern.test(mapping[key])) || !Object.hasOwn(document.sources, mapping.source)) fail('Invalid data mapping');
    const id = JSON.stringify([mapping.stage, mapping.graphic, mapping.field]);
    if (seen.has(id)) fail('Duplicate field mapping');
    seen.add(id);
  }
  return document;
}

// Source reads and credential handling belong to the server. Templates receive
// resolved SPX fields, so additional adapters will not require template changes.
class DataSources extends EventEmitter {
  constructor(file, stages, { sheets = new PublicSheets(), now = Date.now } = {}) {
    super();
    this.file = path.resolve(file);
    this.stages = stages;
    this.sheets = sheets;
    this.now = now;
    this.runtimes = new Map();
    this.inFlight = new Map();
    this.controllers = new Set();
    this.cache = {};
    this.cacheFile = this.file.replace(/\.json$/i, '') + '.sheets-cache.json';
    this.cacheSerial = Promise.resolve();
    this.closed = false;
    this.document = null;
    this.error = '';
    this.checkedAt = null;
    this.serial = Promise.resolve();
    this.ready = this.initialize().catch(() => {
      this.error = 'Local JSON source unavailable or invalid; retaining last valid values';
      this.checkedAt = new Date().toISOString();
    });
  }
  async initialize() {
    const initial = { version: 1, revision: 0, updatedAt: new Date().toISOString(), sources: {}, mappings: [] };
    for (const stage of this.stages) {
      const id = `test.${stage.id}.currentRound`;
      initial.sources[id] = { label: `${stage.title || stage.id} · Current round`, value: 'SWISS ROUND 11 OF 15' };
      initial.mappings.push({ stage: stage.id, graphic: 'ticker', field: 'f5', source: id });
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try { await fs.writeFile(this.file, JSON.stringify(initial, null, 2), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf8');
      if (raw.length < 262144) {
        const cache = JSON.parse(raw);
        if (cache.version === 1 && cache.values && typeof cache.values === 'object') this.cache = cache.values;
      }
    } catch { /* A cache is optional; the manual field remains the fallback. */ }
    await this.read();
  }
  queue(operation) {
    const result = this.serial.then(operation);
    this.serial = result.catch(() => {});
    return result;
  }
  async read() {
    const previous = JSON.stringify([this.document, this.error]);
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      if (raw.length > 262144) fail('Local data file is too large');
      const next = clone(validate(JSON.parse(raw.replace(/^\uFEFF/, ''))));
      if (this.document && (next.revision < this.document.revision || (next.revision === this.document.revision && JSON.stringify(next) !== JSON.stringify(this.document)))) fail('External source edits must advance the document revision');
      this.document = next;
      this.syncRuntimes();
      this.error = '';
    } catch (error) {
      // Keep the last complete valid snapshot; never replace good data with an
      // empty value or a partly written external JSON document.
      this.error = 'Local JSON source unavailable or invalid; retaining last valid values';
    }
    this.checkedAt = new Date().toISOString();
    if (previous !== JSON.stringify([this.document, this.error])) this.emit('change');
    return this.snapshot();
  }
  refresh() { return this.queue(async () => { await this.ready; return this.read(); }); }
  fingerprint(source) { return createHash('sha256').update(JSON.stringify(source.settings)).digest('hex'); }
  syncRuntimes() {
    for (const [id, source] of Object.entries(this.document?.sources || {})) {
      if (source.type !== 'google-sheets') continue;
      const fingerprint = this.fingerprint(source), current = this.runtimes.get(id);
      if (current?.fingerprint === fingerprint) continue;
      const saved = this.cache[id];
      const reusable = saved?.fingerprint === fingerprint && text(saved.value) && typeof saved.lastSuccess === 'string' && Number.isFinite(Date.parse(saved.lastSuccess));
      this.runtimes.set(id, { fingerprint, value: reusable ? saved.value : undefined, lastSuccess: reusable ? saved.lastSuccess : null, lastAttempt: null, nextAt: 0, failures: 0, health: 'loading', error: '' });
    }
    for (const id of this.runtimes.keys()) if (this.document?.sources[id]?.type !== 'google-sheets') this.runtimes.delete(id);
  }
  sourceSnapshot(id, source) {
    if (source.type !== 'google-sheets') return { ...source, type: 'local', health: this.error ? 'error' : 'ok' };
    const runtime = this.runtimes.get(id);
    const stale = !runtime?.lastSuccess || this.now() - Date.parse(runtime.lastSuccess) > source.settings.refreshSeconds * 2000;
    return { ...source, value: runtime?.value, health: this.error ? 'error' : runtime?.health === 'ok' && stale ? 'stale' : runtime?.health || 'loading',
      lastSuccess: runtime?.lastSuccess || null, lastAttempt: runtime?.lastAttempt || null,
      nextRefresh: runtime?.nextAt ? new Date(runtime.nextAt).toISOString() : null,
      error: runtime?.error || '', warning: runtime?.cacheError || '' };
  }
  snapshot() {
    const document = this.document || { version: 1, revision: 0, sources: {}, mappings: [] };
    return clone({ ...document, sources: Object.fromEntries(Object.entries(document.sources).map(([id, source]) => [id, this.sourceSnapshot(id, source)])), health: this.error ? 'unavailable' : 'ok', error: this.error, checkedAt: this.checkedAt });
  }
  mapping(stage, graphic, field) { return this.document?.mappings.find(mapping => mapping.stage === stage && mapping.graphic === graphic && mapping.field === field)?.source; }
  value(id) { return this.document?.sources[id]?.type === 'google-sheets' ? this.runtimes.get(id)?.value : this.document?.sources[id]?.value; }
  edit(expectedRevision, operation) {
    return this.queue(async () => {
      await this.ready;
      await this.read();
      if (this.error) fail('Repair the local JSON source before saving changes', 503);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== this.document.revision) fail('Data changed elsewhere. Reload the Data Manager before saving.', 409);
      const next = clone(this.document);
      operation(next);
      validate(next);
      next.revision++;
      next.updatedAt = new Date().toISOString();
      await fs.writeFile(this.file + '.tmp', JSON.stringify(next, null, 2));
      await fs.rename(this.file + '.tmp', this.file);
      this.document = next;
      this.syncRuntimes();
      this.checkedAt = next.updatedAt;
      this.emit('change');
      return this.snapshot();
    });
  }
  updateSource(id, value, revision) {
    return this.edit(revision, next => {
      if (!Object.hasOwn(next.sources, id)) fail('Unknown source', 404);
      if (next.sources[id].type === 'google-sheets') fail('Google Sheets sources are read-only; edit the source cell in Google Sheets', 422);
      if (!text(value)) fail('Round text must be nonempty, up to 300 characters');
      next.sources[id].value = value;
    });
  }
  updateMapping(mapping, revision) {
    return this.edit(revision, next => {
      const index = next.mappings.findIndex(item => item.stage === mapping.stage && item.graphic === mapping.graphic && item.field === mapping.field);
      if (index < 0) next.mappings.push(mapping); else next.mappings[index] = mapping;
    });
  }
  async persistCache() {
    const values = Object.fromEntries([...this.runtimes].filter(([, runtime]) => text(runtime.value) && runtime.lastSuccess).map(([id, runtime]) => [id, { fingerprint: runtime.fingerprint, value: runtime.value, lastSuccess: runtime.lastSuccess }]));
    const raw = JSON.stringify({ version: 1, values }, null, 2);
    const write = this.cacheSerial.catch(() => {}).then(async () => { await fs.writeFile(this.cacheFile + '.tmp', raw); await fs.rename(this.cacheFile + '.tmp', this.cacheFile); });
    this.cacheSerial = write;
    await write;
    this.cache = values;
  }
  async testSheet(settings) { return this.sheets.read(normalizeSettings(settings)); }
  async addSheet(label, input, revision) {
    if (!text(label)) fail('Enter a source name, up to 300 characters');
    const settings = normalizeSettings(input);
    if (!settings.cell) fail('Test the connection and choose a cell first');
    // Re-read the selected cell instead of trusting browser preview data.
    const read = await this.sheets.read(settings, { singleCell: true });
    const id = 'google.' + randomUUID();
    await this.edit(revision, next => { next.sources[id] = { type: 'google-sheets', label: label.trim(), settings }; });
    const runtime = this.runtimes.get(id), now = this.now();
    Object.assign(runtime, { value: read.value, lastSuccess: new Date(now).toISOString(), lastAttempt: new Date(now).toISOString(), nextAt: now + settings.refreshSeconds * 1000, health: 'ok' });
    try { await this.persistCache(); } catch { runtime.cacheError = 'Value is live, but its restart cache could not be saved'; }
    this.emit('change');
    return { sourceId: id, snapshot: this.snapshot() };
  }
  async refreshSheet(id) {
    await this.ready;
    if (this.closed) return;
    const source = this.document?.sources[id];
    if (source?.type !== 'google-sheets') fail('Unknown Google Sheets source', 404);
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const runtime = this.runtimes.get(id), controller = new AbortController();
    this.controllers.add(controller);
    const job = (async () => {
      runtime.lastAttempt = new Date(this.now()).toISOString();
      try {
        const result = await this.sheets.read(source.settings, { singleCell: true, signal: controller.signal });
        if (this.closed || this.runtimes.get(id) !== runtime) return;
        Object.assign(runtime, { value: result.value, lastSuccess: new Date(this.now()).toISOString(), failures: 0, health: 'ok', error: '', cacheError: '', nextAt: this.now() + source.settings.refreshSeconds * 1000 });
        try { await this.persistCache(); } catch { runtime.cacheError = 'Value is live, but its restart cache could not be saved'; }
      } catch (error) {
        if (this.closed || this.runtimes.get(id) !== runtime) return;
        runtime.failures++;
        runtime.health = 'error'; runtime.error = error.message;
        runtime.nextAt = this.now() + Math.min(3600, source.settings.refreshSeconds * 2 ** Math.min(runtime.failures - 1, 6)) * 1000;
      } finally { this.controllers.delete(controller); }
      if (!this.closed && this.runtimes.get(id) === runtime) this.emit('change');
      return this.snapshot();
    })();
    this.inFlight.set(id, job);
    try { return await job; } finally { if (this.inFlight.get(id) === job) this.inFlight.delete(id); }
  }
  async pollSheets() {
    await this.ready;
    if (this.polling || this.closed || this.error) return;
    this.polling = true;
    try {
      const due = [...this.runtimes].filter(([, runtime]) => runtime.nextAt <= this.now()).map(([id]) => id);
      for (let index = 0; index < due.length && !this.closed; index += 4) await Promise.allSettled(due.slice(index, index + 4).map(id => this.refreshSheet(id)));
    } finally { this.polling = false; }
  }
  close() { this.closed = true; for (const controller of this.controllers) controller.abort(); }
}

module.exports = { DataSources, linkable, validate };
