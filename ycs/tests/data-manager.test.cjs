'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
async function flush() { for (let count = 0; count < 10; count++) await new Promise(resolve => setImmediate(resolve)); }
async function fixture(t) {
  const dom = new JSDOM(await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'), { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only' });
  const { window } = dom, posts = []; let poll;
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const data = { revision: 0, health: 'ok', connections: {}, defaults: [], sources: { 'test.round': { label: 'Local round', value: 'MANUAL VALUE', type: 'local' } }, mappings: [] };
  const rows = [['Stage', 'Round'], ['STAGE 1', '<b>FINALS</b>']].map((row, index) => row.map((value, column) => ({ address: String.fromCharCode(65 + column) + (index + 1), value, usable: true })));
  window.setInterval = callback => { poll = callback; return 1; }; window.clearInterval = () => {};
  window.fetch = async (target, options) => {
    let result;
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body); posts.push({ target, body });
      if (target.endsWith('/test')) result = { rows };
      else if (target.endsWith('/connections')) { data.revision++; data.connections['sheet.test'] = { label: body.label, settings: body.settings, rows, health: 'ok', usages: [], lastSuccess: new Date().toISOString() }; result = { connectionId: 'sheet.test', snapshot: data }; }
      else { data.revision++; result = data; }
    } else if (target.endsWith('/stages')) result = [{ id: 'stage-1', title: 'Stage 1', controller: '/gc/Stage1/Show' }];
    else if (target.endsWith('/graphics')) result = [{ id: 'ticker', title: 'Ticker' }];
    else if (target.includes('/data/mappings/')) result = { revision: data.revision, template: '/test.html', fields: [{ field: 'f5', title: 'Current round', binding: null, origin: 'unassigned' }] };
    else result = data;
    return { ok: true, json: async () => structuredClone(result) };
  };
  window.eval(await fs.readFile(path.join(__dirname, '../public/sheet-picker.js'), 'utf8'));
  window.eval(await fs.readFile(path.join(__dirname, '../public/data-manager.js'), 'utf8')); await flush();
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  const set = (id, value) => { const input = window.document.getElementById(id); input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const connect = async () => { window.document.getElementById('add-connection').click(); set('sheet-label', 'Show'); set('sheet-url', 'https://docs.google.com/spreadsheets/d/1PUBLIC_SHEET_TEST_1234567890/edit'); window.document.getElementById('test-sheet').click(); await flush(); };
  return { window, posts, set, connect, poll: () => poll(), data };
}
test('connection editor tests a reusable dataset, renders literal values and never sends playout', async t => {
  const r = await fixture(t), document = r.window.document;
  assert.equal(document.getElementById('connection-dialog').open, false); await r.connect(); assert.equal(document.getElementById('save-sheet').disabled, false);
  assert.equal(document.querySelector('.sheet-preview b'), null); assert.match(document.querySelector('.sheet-preview').textContent, /<b>FINALS<\/b>/);
  r.set('sheet-range', 'A1:B8'); assert.equal(document.getElementById('save-sheet').disabled, true);
  document.getElementById('test-sheet').click(); await flush(); document.getElementById('save-sheet').click(); await flush();
  assert.equal(r.posts.at(-1).body.settings.cell, undefined); assert.equal(document.querySelector('.connection h3').textContent, 'Show'); assert.equal(document.getElementById('connection-dialog').open, false);
  assert.ok(r.posts.every(post => !post.target.includes('/stages/')));
});
test('mapping drafts and local edits survive polling; row binding and template scope save together at the loaded revision', async t => {
  const r = await fixture(t), document = r.window.document;
  await r.connect(); document.getElementById('save-sheet').click(); await flush(); document.getElementById('reload-mappings').click(); await flush();
  const source = document.querySelector('[aria-label="Current round source"]'); source.value = 'sheet.test'; source.dispatchEvent(new r.window.Event('change'));
  const scope = document.querySelector('[aria-label="Current round mapping scope"]'); scope.value = 'default'; scope.dispatchEvent(new r.window.Event('change'));
  const local = document.querySelector('.local-value input'); local.value = 'UNSAVED LOCAL';
  const rowKey = [...document.querySelectorAll('.selector-fields label')].find(label => label.textContent.startsWith('Row key')).querySelector('input'); rowKey.value = 'STAGE 2'; rowKey.dispatchEvent(new r.window.Event('input'));
  r.data.revision = 99; await r.poll(); assert.equal(source.value, 'sheet.test'); assert.equal(rowKey.value, 'STAGE 2'); assert.equal(local.value, 'UNSAVED LOCAL');
  document.getElementById('save-mappings').click(); await flush(); const saved = r.posts.at(-1);
  assert.equal(saved.body.revision, 1, 'polling must not silently refresh the revision of a mapping draft');
  assert.equal(saved.body.edits[0].scope, 'default'); assert.equal(saved.body.edits[0].binding.selection.keyValue, 'STAGE 2'); assert.equal(saved.body.edits[0].binding.selection.valueColumn, 'Round');
  assert.equal(saved.target, '/api/ycs/data/mappings/stage-1/ticker');
});
