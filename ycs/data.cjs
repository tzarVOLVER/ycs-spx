'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const clone = value => structuredClone(value);
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 300; }
function linkable(item, field) { return item.ycsSlot === 'ticker' && field === 'f5' && item.DataFields.some(definition => definition.field === field && definition.ftype === 'textfield'); }

function validate(document) {
  if (!document || document.version !== 1 || !Number.isSafeInteger(document.revision) || document.revision < 0 || !document.sources || Array.isArray(document.sources) || !Array.isArray(document.mappings)) fail('Invalid local data document');
  if (Object.keys(document.sources).length > 100 || document.mappings.length > 300) fail('Too many data sources or mappings');
  for (const [id, source] of Object.entries(document.sources)) {
    if (!keyPattern.test(id) || !source || !text(source.label) || !text(source.value)) fail('Source labels and values must be nonempty text, up to 300 characters');
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
  constructor(file, stages) {
    super();
    this.file = path.resolve(file);
    this.stages = stages;
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
  snapshot() {
    return clone({ ...(this.document || { version: 1, revision: 0, sources: {}, mappings: [] }), health: this.error ? 'unavailable' : 'ok', error: this.error, checkedAt: this.checkedAt });
  }
  mapping(stage, graphic, field) { return this.document?.mappings.find(mapping => mapping.stage === stage && mapping.graphic === graphic && mapping.field === field)?.source; }
  value(source) { return this.document?.sources[source]?.value; }
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
      this.checkedAt = next.updatedAt;
      this.emit('change');
      return this.snapshot();
    });
  }
  updateSource(id, value, revision) {
    return this.edit(revision, next => {
      if (!Object.hasOwn(next.sources, id)) fail('Unknown source', 404);
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
}

module.exports = { DataSources, linkable, validate };
