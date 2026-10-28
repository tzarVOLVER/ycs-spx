'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
async function controller(t, compact = false) {
  const dom = new JSDOM(`<html data-ycs-stage="stage-1"><head></head><body><div id="controllerPluginButtons"></div><iframe id="previewIF"></iframe>
    <div class="itemrow inFocus" data-spx-epoch="ticker"><div class="truncate"></div><div id="Expanded" style="display:block"></div>
    <input data-update="f0" type="hidden" value="broadcast-1"><input data-update="f5" class="gcinput" value="MANUAL ROUND">
    <input name="RundownItem[onair]" value="false"><span data-spx-name="icon"></span><span data-spx-name="deletelarge"></span>
    <button data-spx-name="playbutton" data-spx-playtext="PLAY" data-spx-stoptext="STOP"></button><button data-spx-name="updatebutton" class="disabled">Update</button></div></body></html>`, { url: 'http://localhost/gc/Stage1/Show', runScripts: 'outside-only' });
  const { window } = dom, posts = [], channels = new Map();
  const row = window.document.querySelector('.itemrow');
  const originalRound=row.querySelector('[data-update="f5"]');
  if(compact){
    const expanded=row.querySelector('#Expanded');expanded.innerHTML='<table><tbody><tr><td colspan="3" class="spxTableHeadsmall"><span>YCS TICKER 1</span><i class="l-icon">Edit</i></td></tr><tr><td width="65%"></td><td width="35%"><button onclick="saveTemplateItemChangesByElement(this.closest(\'.itemrow\'))">Save</button></td></tr></tbody></table>';
    const cell=expanded.querySelector('td[width="65%"]');cell.append(row.querySelector('[data-update="f0"]'),originalRound);
    for(const [field,type,value]of [['f2','checkbox','1'],['f8','number','145'],['f14','textarea','[]']]){const input=window.document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.dataset.update=field;input.name=`RundownItem[${field}]`;input.value=value;input.checked=type==='checkbox';input.className='gcinput';cell.append(input);}
  }
  let revision = 0, closed = 0, validationError;
  window.setMasterButtonStates = () => {};
  window.getFocusedRow = () => row;
  window.ToggleExpand = () => { closed++; row.querySelector('#Expanded').style.display = 'none'; };
  window.io = () => ({ on: (event, callback) => channels.set(event, callback), emit() {}, disconnect() {} });
  window.fetch = async (url, request) => {
    let payload;
    if (request?.method === 'POST') {
      const body = JSON.parse(request.body); posts.push({ url, body });
      if(validationError)return {ok:false,json:async()=>({error:'Current round: Value exceeds 300 characters',fields:validationError})};
      const action = url.split('/').at(-1);
      payload = { editorRevision: action === 'stop' ? 99 : action === 'preview' ? revision : ++revision };
    } else if (url.endsWith('/editor')) payload = { revision, links: { f5: { mode: 'manual', manual: 'MANUAL ROUND' },...(compact?{f2:{mode:'manual',manual:'1'}}:{}) }, fields: compact?[{field:'f0',ftype:'hidden',title:'Identity'},{field:'f2',ftype:'checkbox',title:'Show rounds remaining'},{field:'f5',ftype:'textfield',title:'Current round'},{field:'f8',ftype:'number',title:'Crawl speed'},{field:'f14',ftype:'textarea',title:'Stories',ycsCollection:{version:1,fields:[{key:'subtopic'}]}}]:[] };
    else if (url.endsWith('/data')) payload = { health: 'ok', sources: { 'test.round': { label: 'Test round', value: 'LINKED ROUND' } }, mappings: [{ stage: 'stage-1', graphic: 'ticker', field: 'f5', source: 'test.round' }] };
    else if (url.endsWith('/health')) payload = { program: { connected: 0, ready: 0, errors: [] }, preview: { connected: 0, ready: 0, errors: [] } };
    else payload = [];
    return { ok: true, json: async () => payload };
  };
  window.eval(await fs.readFile(path.join(__dirname, '../public/controller.js'), 'utf8'));
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve));
  const program = graphics => channels.get('state')({ stage: 'stage-1', mode: 'program', graphics });
  return { window, row, posts, program, originalRound, closed: () => closed, rejectFields: errors => { validationError=errors; } };
}

test('native chain previews without Play and program state enables Update and protects active rows', async t => {
  const r = await controller(t);
  assert.equal(r.posts.length, 0);
  r.row.querySelector('.ycs-link-toggle').click();
  await r.window.previewItem(r.row);
  assert.ok(r.posts.every(post => post.url.endsWith('/preview')));
  const last = r.posts.at(-1).body;
  assert.equal(last.links.f5.manual, 'MANUAL ROUND');
  assert.equal(last.links.f5.mode, 'linked');
  assert.equal(r.row.querySelector('[data-update="f5"]').readOnly, true);
  r.program([{ id: 'ticker', links: { f5: { mode: 'linked', source: 'test.round' } } }]);
  assert.equal(r.row.querySelector('[data-spx-name="updatebutton"]').classList.contains('disabled'), false);
  assert.equal(r.row.querySelector('[data-spx-name="deletelarge"]').style.visibility, 'hidden');
  r.program([]);
  assert.equal(r.row.querySelector('[data-spx-name="updatebutton"]').classList.contains('disabled'), true);
});

test('field validation errors appear beside their input and clear after a successful correction',async t=>{
 const r=await controller(t),input=r.row.querySelector('[data-update="f5"]');
 r.rejectFields({f5:'Value exceeds 300 characters'});await r.window.updateItem(r.row);
 assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(r.row.querySelector('.ycs-field-error').textContent,'Value exceeds 300 characters');
 assert.ok(input.getAttribute('aria-describedby').includes(r.row.querySelector('.ycs-field-error').id));
 assert.equal(r.closed(),0);
 r.rejectFields(null);await r.window.previewItem(r.row);
 assert.equal(input.hasAttribute('aria-invalid'),false);assert.equal(r.row.querySelector('.ycs-field-error'),null);
 assert.equal(r.window.document.querySelector('.ycs-command-status').textContent,'');
});

test('native Save closes the editor; Stop does not silently refresh a stale editing revision', async t => {
  const r = await controller(t);
  await r.window.saveTemplateItemChangesByElement(r.row);
  assert.equal(r.closed(), 1);
  assert.equal(r.row.querySelector('.truncate').textContent, 'MANUAL ROUND');
  await r.window.playItem(r.row, 'stop');
  await r.window.updateItem(r.row);
  assert.equal(r.posts.at(-1).body.revision, 1);
});

test('compact native editor preserves field nodes and values, keeps checkbox editing and link changes off air, and saves all advanced fields',async t=>{
  const r=await controller(t,true),input=r.row.querySelector('[data-update="f5"]'),checkbox=r.row.querySelector('[data-update="f2"]');
  assert.equal(input,r.originalRound,'moving labels must not replace native inputs or their handlers');assert.equal(r.posts.length,0);
  assert.ok(r.row.querySelector('.ycs-editor-heading').contains(checkbox));assert.equal(r.row.querySelector('.ycs-editor-title').textContent,'YCS TICKER 1');assert.equal(r.row.querySelector('.ycs-editor-title use').getAttribute('href'),'/ycs/editor-icons.svg#square-pen');
  const button=input.previousElementSibling,detail=r.window.document.getElementById(input.getAttribute('aria-describedby'));assert.match(button.title,/Test round/);assert.equal(detail.classList.contains('is-warning'),false);
  checkbox.checked=false;checkbox.dispatchEvent(new r.window.Event('input',{bubbles:true}));button.click();await r.window.previewItem(r.row);
  assert.equal(input.readOnly,true);assert.ok(r.posts.every(post=>post.url.endsWith('/preview')));
  assert.equal(r.posts.at(-1).body.links.f2.manual,'0');assert.equal(r.posts.at(-1).body.links.f5.mode,'linked');
  button.click();await r.window.previewItem(r.row);assert.equal(input.value,'MANUAL ROUND');assert.equal(input.readOnly,false);
  await r.window.saveTemplateItemChangesByElement(r.row);const saved=r.posts.at(-1);assert.ok(saved.url.endsWith('/save'));assert.deepEqual(saved.body.fields.map(field=>field.field).sort(),['f0','f14','f2','f5','f8']);assert.equal(saved.body.fields.find(field=>field.field==='f2').value,'0');assert.equal(saved.body.fields.find(field=>field.field==='f8').value,'145');assert.equal(saved.body.fields.find(field=>field.field==='f14').value,'[]');assert.equal(r.closed(),1);
});
