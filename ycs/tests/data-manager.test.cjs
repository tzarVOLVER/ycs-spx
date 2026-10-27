'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const url = 'https://docs.google.com/spreadsheets/d/1PUBLIC_SHEET_TEST_1234567890/edit#gid=42';
async function flush() { for (let count = 0; count < 10; count++) await new Promise(resolve => setImmediate(resolve)); }
async function fixture(t) {
  const html = await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only' });
  const { window } = dom, posts = [];
  let poll, sourceValue = '<b>FINALS</b>', data = { revision: 0, health: 'ok', sources: { 'test.round': { label: 'Local round', value: 'MANUAL VALUE', type: 'local' } }, mappings: [{ stage: 'stage-1', graphic: 'ticker', field: 'f5', source: 'test.round' }] };
  window.setInterval = callback => { poll = callback; return 1; }; window.clearInterval = () => {};
  window.fetch = async (target, options) => {
    let result;
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body); posts.push({ target, body });
      if (target.endsWith('/test')) result = { settings: { ...body.settings, url: url.split('#')[0], worksheet: '42' }, rows: [[{ address: 'A1', value: 'Round', usable: true }], [{ address: 'A2', value: sourceValue, usable: true }], [{ address: 'A3', value: '', usable: false }]] };
      else if (target.endsWith('/sheets')) {
        data = { ...data, revision: data.revision + 1, sources: { ...data.sources, 'google.test': { type: 'google-sheets', label: body.label, settings: body.settings, value: sourceValue, health: 'ok', lastSuccess: new Date().toISOString() } } };
        result = { sourceId: 'google.test', snapshot: data };
      } else result = data;
    } else if (target.endsWith('/stages')) result = [{ id: 'stage-1', title: 'Stage 1', controller: '/gc/Stage1/Show' }];
    else result = data;
    return { ok: true, json: async () => result };
  };
  window.eval(await fs.readFile(path.join(__dirname, '../public/data-manager.js'), 'utf8')); await flush();
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  const set = (id, value) => { const element = window.document.getElementById(id); element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const connect = async () => {
    set('sheet-label', 'Public round'); set('sheet-url', url);
    window.document.getElementById('test-sheet').click(); await flush();
    [...window.document.querySelectorAll('.sheet-cell')].find(cell => cell.textContent.startsWith('A2')).click();
  };
  return { window, posts, set, connect, poll: () => poll(), update: value => { sourceValue = value; if (data.sources['google.test']) data.sources['google.test'].value = value; } };
}

test('Data Manager tests a range, picks a safe text cell, adds a source and never sends a playout command', async t => {
  const r = await fixture(t), document = r.window.document;
  assert.equal(document.getElementById('save-sheet').disabled, true);
  await r.connect();
  assert.equal(document.getElementById('save-sheet').disabled, false);
  assert.equal(document.querySelector('.sheet-preview b'), null, 'cell data must be literal text');
  assert.equal(document.querySelectorAll('.sheet-cell')[2].disabled, true);
  document.getElementById('save-sheet').click(); await flush();
  assert.equal(r.posts.at(-1).body.settings.cell, 'A2');
  assert.equal(document.querySelector('.remote-value').textContent, '<b>FINALS</b>');
  assert.equal(document.querySelector('.remote-source b'), null);
  assert.ok(r.posts.every(post => !post.target.includes('/stages/')));
  assert.ok(document.getElementById('mapping-stage-1').querySelector('[value="google.test"]'));
});

test('changing sheet settings invalidates selection; live polling preserves manual edits and mapping drafts', async t => {
  const r = await fixture(t), document = r.window.document;
  await r.connect(); r.set('sheet-range', 'A1:B3');
  assert.equal(document.getElementById('save-sheet').disabled, true);
  assert.equal(document.querySelectorAll('.sheet-cell').length, 0);
  document.getElementById('test-sheet').click(); await flush();
  [...document.querySelectorAll('.sheet-cell')].find(cell => cell.textContent.startsWith('A2')).click();
  document.getElementById('save-sheet').click(); await flush();
  r.set('source-test.round', 'UNSAVED MANUAL TEXT');
  r.set('mapping-stage-1', 'google.test');
  r.update('NEXT LIVE ROUND'); await r.poll();
  assert.equal(document.querySelector('.remote-value').textContent, 'NEXT LIVE ROUND');
  assert.equal(document.getElementById('source-test.round').value, 'UNSAVED MANUAL TEXT');
  assert.equal(document.getElementById('mapping-stage-1').value, 'google.test');
});
