'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
async function controller(t) {
  const dom = new JSDOM(`<html data-ycs-stage="stage-1"><head></head><body><div id="controllerPluginButtons"></div><iframe id="previewIF"></iframe>
    <div class="itemrow inFocus" data-spx-epoch="ticker"><div class="truncate"></div><div id="Expanded" style="display:block"></div>
    <input data-update="f0" type="hidden" value="broadcast-1"><input data-update="f5" class="gcinput" value="MANUAL ROUND">
    <input name="RundownItem[onair]" value="false"><span data-spx-name="icon"></span><span data-spx-name="deletelarge"></span>
    <button data-spx-name="playbutton" data-spx-playtext="PLAY" data-spx-stoptext="STOP"></button><button data-spx-name="updatebutton" class="disabled">Update</button></div></body></html>`, { url: 'http://localhost/gc/Stage1/Show', runScripts: 'outside-only' });
  const { window } = dom, posts = [], channels = new Map();
  const row = window.document.querySelector('.itemrow');
  let revision = 0, closed = 0;
  window.setMasterButtonStates = () => {};
  window.getFocusedRow = () => row;
  window.ToggleExpand = () => { closed++; row.querySelector('#Expanded').style.display = 'none'; };
  window.io = () => ({ on: (event, callback) => channels.set(event, callback), emit() {}, disconnect() {} });
  window.fetch = async (url, request) => {
    let payload;
    if (request?.method === 'POST') {
      const body = JSON.parse(request.body); posts.push({ url, body });
      const action = url.split('/').at(-1);
      payload = { editorRevision: action === 'stop' ? 99 : action === 'preview' ? revision : ++revision };
    } else if (url.endsWith('/editor')) payload = { revision, links: { f5: { mode: 'manual', manual: 'MANUAL ROUND' } }, fields: [] };
    else if (url.endsWith('/data')) payload = { health: 'ok', sources: { 'test.round': { label: 'Test round', value: 'LINKED ROUND' } }, mappings: [{ stage: 'stage-1', graphic: 'ticker', field: 'f5', source: 'test.round' }] };
    else if (url.endsWith('/health')) payload = { program: { connected: 0, ready: 0, errors: [] }, preview: { connected: 0, ready: 0, errors: [] } };
    else payload = [];
    return { ok: true, json: async () => payload };
  };
  window.eval(await fs.readFile(path.join(__dirname, '../public/controller.js'), 'utf8'));
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve));
  const program = graphics => channels.get('state')({ stage: 'stage-1', mode: 'program', graphics });
  return { window, row, posts, program, closed: () => closed };
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

test('native Save closes the editor; Stop does not silently refresh a stale editing revision', async t => {
  const r = await controller(t);
  await r.window.saveTemplateItemChangesByElement(r.row);
  assert.equal(r.closed(), 1);
  assert.equal(r.row.querySelector('.truncate').textContent, 'MANUAL ROUND');
  await r.window.playItem(r.row, 'stop');
  await r.window.updateItem(r.row);
  assert.equal(r.posts.at(-1).body.revision, 1);
});
