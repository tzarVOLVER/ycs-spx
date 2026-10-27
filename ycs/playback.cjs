// YCS stage playback. Each stage owns a program composition and preview draft.
// The shared service is used by the SPX editor and explicit Companion commands.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const clone = value => structuredClone(value);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }

class RundownRepository {
  constructor(root, stages) {
    this.stages = new Map();
    for (const stage of stages) {
      if (!identifier.test(stage.id) || !identifier.test(stage.project) || !identifier.test(stage.rundown)) fail('Invalid stage configuration');
      if (this.stages.has(stage.id)) fail('Duplicate stage');
      this.stages.set(stage.id, { ...stage, file: path.resolve(root, stage.project, 'data', stage.rundown + '.json') });
    }
  }
  stage(id) { return this.stages.get(id) || fail('Unknown stage', 404); }
  matchFile(file) {
    if (typeof file !== 'string') return;
    const target = path.resolve(file);
    return [...this.stages.values()].find(stage => process.platform === 'win32' ? stage.file.toLowerCase() === target.toLowerCase() : stage.file === target);
  }
  async read(id) {
    const stage = this.stage(id);
    const rundown = JSON.parse(await fs.readFile(stage.file, 'utf8'));
    if (!Array.isArray(rundown.templates)) fail('Invalid stage rundown', 500);
    const ids = rundown.templates.map(item => item.itemID);
    if (new Set(ids).size !== ids.length) fail('Rundown graphic IDs must be unique', 500);
    return rundown;
  }
  async write(id, rundown) {
    const file = this.stage(id).file;
    await fs.writeFile(file + '.ycs-tmp', JSON.stringify({ ...rundown, updated: new Date().toISOString() }, null, 2));
    await fs.rename(file + '.ycs-tmp', file);
  }
  item(rundown, id) { return rundown.templates.find(item => item.itemID === id) || fail('Unknown graphic', 404); }
}

function fieldValues(item, input) {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length > 100) fail('Fields must be an array');
  const definitions = new Map(item.DataFields.map(field => [field.field, field]));
  const seen = new Set();
  for (const incoming of input) {
    if (!incoming || typeof incoming.field !== 'string' || seen.has(incoming.field)) fail('Invalid or duplicate field');
    seen.add(incoming.field);
    const definition = definitions.get(incoming.field);
    if (!definition) fail('Unknown template field');
    if (typeof incoming.value !== 'string' || incoming.value.length > 65536) fail('Invalid template field value');
    // Hidden instance identity cannot be changed by an editor/API patch.
    if (incoming.field === 'f0' && definition.ftype === 'hidden' && incoming.value !== definition.value) fail('Instance identity is read-only');
  }
  for (const incoming of input) definitions.get(incoming.field).value = incoming.value;
}

function descriptor(item, slots) {
  const slot = Object.hasOwn(slots, item.ycsSlot) && slots[item.ycsSlot];
  if (!slot) fail('Graphic has no configured display slot', 422);
  if (typeof item.relpath !== 'string' || !/^\/[a-zA-Z0-9_./-]+\.html?$/.test(item.relpath) || item.relpath.split('/').includes('..')) fail('Invalid template path', 422);
  const data = Object.fromEntries(item.DataFields.filter(field => field.field).map(field => [field.field, field.value ?? '']));
  return { id: item.itemID, slot: item.ycsSlot, z: slot.order, exitMs: slot.exitMs ?? 250, template: '/templates' + item.relpath, data };
}

class Playback extends EventEmitter {
  constructor(repository, slots) {
    super();
    this.repository = repository;
    this.slots = slots;
    for (const [name, slot] of Object.entries(slots)) {
      if (!identifier.test(name) || !Number.isInteger(slot.order) || slot.order < 0 || slot.order > 9999) fail('Invalid display slot configuration');
    }
    this.states = new Map();
    this.queues = new Map();
    for (const stage of repository.stages.values()) this.states.set(stage.id, { revision: 0, program: [], draft: null });
  }
  state(stageId) { this.repository.stage(stageId); return this.states.get(stageId); }
  snapshot(stageId, mode) {
    if (!['program', 'preview'].includes(mode)) fail('Unknown output mode', 404);
    const state = this.state(stageId);
    const items = clone(state.program);
    if (mode === 'preview' && state.draft) {
      const index = items.findIndex(item => item.slot === state.draft.slot);
      if (index < 0) items.push(clone(state.draft)); else items[index] = clone(state.draft);
    }
    return { stage: stageId, mode, revision: state.revision, graphics: items.sort((a, b) => a.z - b.z) };
  }
  queue(stageId, operation) {
    this.repository.stage(stageId);
    const result = (this.queues.get(stageId) || Promise.resolve()).then(operation);
    this.queues.set(stageId, result.catch(() => {}));
    return result;
  }
  publish(stageId) {
    this.state(stageId).revision++;
    for (const mode of ['program', 'preview']) this.emit(stageId + ':' + mode, this.snapshot(stageId, mode));
  }
  async catalog(stageId) {
    const rundown = await this.repository.read(stageId);
    return rundown.templates.map(item => ({ id: item.itemID, title: item.description, slot: item.ycsSlot }));
  }
  command(stageId, graphicId, action, fields) {
    if (!['play', 'stop', 'update', 'preview', 'save', 'continue'].includes(action)) fail('Unknown command');
    return this.queue(stageId, async () => {
      const rundown = await this.repository.read(stageId);
      const item = this.repository.item(rundown, graphicId);
      fieldValues(item, fields); // all validation happens on a detached rundown
      const graphic = descriptor(item, this.slots);
      const state = this.state(stageId);
      const active = state.program.find(current => current.id === graphicId);
      if (action === 'preview') {
        state.draft = graphic;
      } else if (action === 'save') {
        await this.repository.write(stageId, rundown);
        if (state.draft?.id === graphicId) state.draft = graphic;
      } else if (action === 'continue') {
        if (!active) fail('Graphic is not active', 409);
        if (!(Number(item.steps) > 1)) fail('Graphic has no continuation step', 422);
        // An explicit increment is replayed only within this connected session.
        active.continuation = (active.continuation || 0) + 1;
      } else {
        let next = clone(state.program);
        if (action === 'play') {
          // Repeating Play for an active graphic updates it without an IN replay.
          next = next.filter(current => current.slot !== graphic.slot);
          if (active?.continuation) graphic.continuation = active.continuation;
          next.push(graphic);
        } else if (action === 'stop') {
          next = next.filter(current => current.id !== graphicId);
        } else if (active) {
          graphic.continuation = active.continuation;
          next = next.map(current => current.id === graphicId ? graphic : current);
        }
        for (const candidate of rundown.templates) candidate.onair = String(next.some(current => current.id === candidate.itemID));
        await this.repository.write(stageId, rundown);
        state.program = next;
        if (state.draft?.id === graphicId && action !== 'stop') state.draft = graphic;
      }
      this.publish(stageId);
      return this.snapshot(stageId, action === 'preview' || action === 'save' ? 'preview' : 'program');
    });
  }
  clear(stageId) {
    return this.queue(stageId, async () => {
      const rundown = await this.repository.read(stageId);
      for (const item of rundown.templates) item.onair = 'false';
      await this.repository.write(stageId, rundown);
      const state = this.state(stageId);
      state.program = [];
      state.draft = null;
      this.publish(stageId);
      return this.snapshot(stageId, 'program');
    });
  }
}

module.exports = { Playback, RundownRepository, fieldValues };
