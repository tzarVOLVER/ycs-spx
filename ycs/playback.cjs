// YCS stage playback. Each stage owns a program composition and preview draft.
// The shared service is used by the SPX editor and explicit Companion commands.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { linkable } = require('./data.cjs');
const {types,normalizeField}=require('./field-types.cjs');

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

function prepareEdits(item,edits){
  if(!Array.isArray(edits)||edits.length>100||new Set(edits.map(edit=>edit.field)).size!==edits.length)fail('Invalid field mappings');
  return edits.map(edit=>{const field=item.DataFields.find(field=>field.field===edit.field);if(!field||!linkable(item,edit.field))fail('Unknown or protected field',422);const next=clone(edit),pick=next.binding;if(pick){const isList=pick.selection?.kind==='collection';if(Boolean(field.ycsCollection)!==isList)fail(field.ycsCollection?'Map a story list for this field':'Choose a single value for this field',422);if(isList){const schema=require('./collections.cjs').schema(field);if(!schema)fail('Unsupported template collection schema',422);if(Object.keys(pick.selection.fields||{}).some(key=>!schema.fields.some(field=>field.key===key)))fail('Unknown story field',422);pick.selection.required=schema.fields.filter(field=>field.required).map(field=>field.key);}}return next;});
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
    if(definition.ycsCollection)normalizeField(definition,incoming.value);
    // Hidden instance identity cannot be changed by an editor/API patch.
    if (incoming.field === 'f0' && definition.ftype === 'hidden' && incoming.value !== definition.value) fail('Instance identity is read-only');
  }
  for (const incoming of input) definitions.get(incoming.field).value = incoming.value;
}

function descriptor(item, slots, sources) {
  const slot = Object.hasOwn(slots, item.ycsSlot) && slots[item.ycsSlot];
  if (!slot) fail('Graphic has no configured display slot', 422);
  if (typeof item.relpath !== 'string' || !/^\/[a-zA-Z0-9_./-]+\.html?$/.test(item.relpath) || item.relpath.split('/').includes('..')) fail('Invalid template path', 422);
  const data = Object.fromEntries(item.DataFields.filter(field => field.field).map(field => [field.field, field.value ?? '']));
  const links = {};
  for (const [field, link] of Object.entries(item.ycsLinks || {})) {
    if (!linkable(item, field)) continue;
    const source = sources?.mapping(item.ycsStage, item.itemID, field, item.relpath);
    const definition=item.DataFields.find(item=>item.field===field);
    links[field] = { ...link, source, definition:{ftype:definition.ftype,...(definition.ycsCollection?{ycsCollection:definition.ycsCollection}:{}),...(definition.items?{items:definition.items}:{})} };
    if (link.mode === 'linked' && sources?.value(source)!==undefined) {try {data[field]=normalizeField(definition,sources.value(source));}catch{/* Retain the manual fallback for incompatible source values. */}}
  }
  return { id: item.itemID, slot: item.ycsSlot, z: slot.order, exitMs: slot.exitMs ?? 250, template: '/templates' + item.relpath, data, ...(Object.keys(links).length ? { links } : {}) };
}

class Playback extends EventEmitter {
  constructor(repository, slots, sources) {
    super();
    this.repository = repository;
    this.slots = slots;
    this.sources = sources;
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
    return { stage: stageId, mode, revision: state.revision, selected: state.draft?.id || null, graphics: items.sort((a, b) => a.z - b.z) };
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
    await this.sources?.ready;
    const rundown = await this.repository.read(stageId);
    return rundown.templates.map(item => ({ id:item.itemID,title:item.description||item.itemID,slot:item.ycsSlot,template:item.relpath,fields:item.DataFields.filter(field=>linkable(item,field.field)).map(field=>({field:field.field,title:field.title||field.field,ftype:field.ftype,type:types[field.ftype],required:field.required===true,...(field.ycsCollection?{ycsCollection:field.ycsCollection,type:'Story list'}:{})})),mapped:item.DataFields.filter(field=>linkable(item,field.field)&&this.sources?.mapping(stageId,item.itemID,field.field,item.relpath)).length }));
  }
  async editor(stageId, graphicId) {
    await this.sources?.ready;
    const item = this.repository.item(await this.repository.read(stageId), graphicId);
    const links = {};
    for (const field of item.DataFields) if (linkable(item, field.field)) {
      const saved = item.ycsLinks?.[field.field] || { mode: 'manual', manual: field.value ?? '' };
      links[field.field] = { ...saved, source: this.sources?.mapping(stageId, graphicId, field.field, item.relpath) || null };
    }
    return { revision: item.ycsEditRevision || 0, title: item.description || graphicId, template: item.relpath, fields: clone(item.DataFields), links };
  }
  async mappingPreview(stageId,graphicId,edits=[]) {
    await this.sources?.ready;
    const item=this.repository.item(await this.repository.read(stageId),graphicId);
    edits=prepareEdits(item,edits);
    const graphic=descriptor(item,this.slots);
    const fields=await Promise.all(item.DataFields.filter(field=>linkable(item,field.field)).map(async field=>{
      const draft=edits.find(edit=>edit.field===field.field);
      const effective=this.sources.effective(stageId,graphicId,field.field,item.relpath);
      const pick=draft&&draft.scope!=='inherit'?draft.binding:draft?this.sources.document.defaults.find(entry=>entry.stage===stageId&&entry.template===item.relpath&&entry.field===field.field)?.binding||null:effective.binding;
      let value=String(field.value??''),health='manual',error='',collection;
      if(pick) {
        try {
          const checked=require('./data.cjs').binding(this.sources.document,pick);
          const connection=this.sources.document.connections[checked.connection||this.sources.document.sources[checked.source]?.binding?.connection];
          if(connection?.project&&connection.project!==this.repository.stage(stageId).project)fail('This source belongs to another project',422);
          const ref=this.sources.reference(checked);await this.sources.ensureCollectionHeaders(checked);const source=this.sources.resolveSnapshot(ref);collection=source.collection;
          if(source.value===undefined)throw new Error(source.error||'Waiting for a valid source value');
          value=normalizeField(field,source.value);health=source.health;error=source.error||'';
        }catch(problem){health='error';error=problem.message;}
      }
      graphic.data[field.field]=value;
      return {field:field.field,title:field.title||field.field,ftype:field.ftype,type:types[field.ftype],required:field.required===true,...(field.ycsCollection?{ycsCollection:field.ycsCollection,type:'Story list'}:{}),manual:String(field.value??''),binding:pick,origin:effective.origin,value,health,error,...(collection?{collection}:{})};
    }));
    return {revision:this.sources.snapshot().revision,template:item.relpath,title:item.description||graphicId,graphic,fields};
  }
  command(stageId, graphicId, action, fields, options = {}) {
    if (!['play', 'stop', 'update', 'preview', 'save', 'continue'].includes(action)) fail('Unknown command');
    return this.queue(stageId, async () => {
      const rundown = await this.repository.read(stageId);
      const item = this.repository.item(rundown, graphicId);
      await this.sources?.ready;
      const changesData = ['play', 'update', 'save', 'preview'].includes(action);
      if (changesData && options.revision !== undefined && options.revision !== (item.ycsEditRevision || 0)) fail('This graphic was saved in another controller. Reload before continuing.', 409);
      if (changesData && options.links !== undefined && (!options.links || typeof options.links !== 'object' || Array.isArray(options.links))) fail('Invalid field links');
      if (changesData) {
        // Validate every incoming value before filtering linked display values.
        const checked = clone(item);
        fieldValues(checked, fields);
        const links = clone(item.ycsLinks || {});
        for (const [field, link] of Object.entries(options.links || {})) {
          if (!linkable(item, field) || !link || !['manual', 'linked'].includes(link.mode) || typeof link.manual !== 'string' || link.manual.length > (item.DataFields.find(def=>def.field===field)?.ycsCollection?65536:300)) fail('Invalid field link');
          if (link.mode === 'linked' && !this.sources?.mapping(stageId, graphicId, field, item.relpath)) fail('Assign a source in Data Manager before linking this field', 422);
          links[field] = { mode: link.mode, manual: link.manual };
        }
        for (const field of item.DataFields) {
          if (!linkable(item, field.field)) continue;
          const link = links[field.field];
          if (!link) continue;
          const incoming = fields?.find(candidate => candidate.field === field.field);
          if (link.mode === 'manual' && incoming) link.manual = incoming.value;
          if (link.manual.length > (field.ycsCollection?65536:300)) fail('Manual value exceeds the field limit');
          if(field.ycsCollection)normalizeField(field,link.manual);
          // The persisted field remains the manual fallback, not a transient
          // source value copied out of the editor's read-only input.
          checked.DataFields.find(candidate => candidate.field === field.field).value = link.manual;
        }
        item.DataFields = checked.DataFields;
        if (Object.keys(links).length) item.ycsLinks = links;
      }
      const graphic = descriptor({ ...item, ycsStage: stageId }, this.slots, this.sources);
      const state = this.state(stageId);
      const active = state.program.find(current => current.id === graphicId);
      if (action === 'preview') {
        state.draft = graphic;
      } else if (action === 'save') {
        item.ycsEditRevision = (item.ycsEditRevision || 0) + 1;
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
        if (changesData) item.ycsEditRevision = (item.ycsEditRevision || 0) + 1;
        for (const candidate of rundown.templates) candidate.onair = String(next.some(current => current.id === candidate.itemID));
        await this.repository.write(stageId, rundown);
        state.program = next;
        if (state.draft?.id === graphicId && action !== 'stop') state.draft = graphic;
      }
      this.publish(stageId);
      return { ...this.snapshot(stageId, action === 'preview' || action === 'save' ? 'preview' : 'program'), editorRevision: item.ycsEditRevision || 0 };
    });
  }
  refreshLinks(stageId) {
    return this.queue(stageId, async () => {
      const state = this.state(stageId);
      let changed = false;
      for (const graphic of [...state.program, ...(state.draft ? [state.draft] : [])]) {
        for (const [field, link] of Object.entries(graphic.links || {})) {
          let value = this.sources?.value(link.source);
          if(value!==undefined){try{value=normalizeField(link.definition||{ftype:'textfield'},value);}catch{continue;}}
          if (link.mode === 'linked' && value !== undefined && value !== graphic.data[field]) {
            graphic.data[field] = value;
            changed = true;
          }
        }
      }
      if (changed) this.publish(stageId);
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

module.exports = { Playback, RundownRepository, fieldValues, prepareEdits };
