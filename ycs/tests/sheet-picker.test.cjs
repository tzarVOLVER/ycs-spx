'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { PublicSheets, parseWorksheets } = require('../public-sheets.cjs');
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1PUBLIC_SHEET_TEST_1234567890/edit#gid=42';
const metadata = 'items.push({name: "Stage \\x31", pageUrl: "https:\\/\\/docs.google.com/ignored", gid: "42",initialSheet:false});items.push({name: "Finals \\u0026 \\x3cResults\\x3e", pageUrl: "ignored", gid: "99",initialSheet:false});';
async function flush() { for (let count = 0; count < 5; count++) await new Promise(resolve => setImmediate(resolve)); }
async function fixture(t, override) {
  const dom = new JSDOM(await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'), { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, calls = []; let invalidations = 0;
  const $ = id => window.document.getElementById(id);
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.eval(await fs.readFile(path.join(__dirname, '../public/sheet-picker.js'), 'utf8'));
  const picker = new window.YCSSheetPicker({ invalidate: () => { invalidations++; }, request: async (url, body) => {
    calls.push({ url, body }); if (override) return override(url, body);
    if (url.endsWith('/worksheets')) return { worksheets: [{ id: '42', name: 'Stage 1' }, { id: '99', name: 'Finals' }], selected: '42' };
    const { firstColumn, firstRow, lastColumn, lastRow } = require('../public-sheets.cjs').parseRange(body.settings.range);
    const rows = Array.from({ length: lastRow - firstRow + 1 }, (_, index) => Array.from({ length: lastColumn - firstColumn + 1 }, (_, column) => ({ address: picker.column(firstColumn + column) + (firstRow + index), value: index === 0 ? '<b>Literal</b>' : '', usable: index === 0 })));
    return { rows };
  } });
  $('sheet-url').value = sheetUrl; $('connection-dialog').showModal(); picker.reset({ worksheet: '' }); await flush();
  t.after(() => { picker.dispose(); window.close(); });
  return { window, $, picker, calls, invalidations: () => invalidations };
}
test('public tab descriptors are decoded as scalar data, without executing scripts or accepting arbitrary hosts', async () => {
  assert.deepEqual(parseWorksheets(metadata), [{ id: '42', name: 'Stage 1' }, { id: '99', name: 'Finals & <Results>' }]);
  assert.throws(() => parseWorksheets('<html>Sign in</html>'), { status: 502 });
  assert.throws(() => parseWorksheets('items.push({name: process.exit(), pageUrl:"x",gid:"42"})'), { status: 502 });
  const sheets = new PublicSheets(async (url, options) => { assert.equal(url, sheetUrl.split('/edit')[0] + '/htmlview'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); return new Response(metadata); });
  assert.equal((await sheets.worksheets({ url: sheetUrl })).worksheets[1].id, '99');
  await assert.rejects(sheets.worksheets({ url: 'http://127.0.0.1/private' }), { status: 400 });
  await assert.rejects(new PublicSheets(async () => new Response(null, { status: 302 })).worksheets({ url: sheetUrl }), { status: 502 });
  await assert.rejects(new PublicSheets(async () => new Response('x'.repeat(2097153))).worksheets({ url: sheetUrl }), { status: 502 });
});
test('worksheet dropdown loads real names, honors URL gid and supports a manual fallback', async t => {
  const r = await fixture(t); assert.equal(r.$('sheet-worksheet').value, '42'); assert.equal(r.picker.worksheet, '42');
  assert.equal(r.$('sheet-worksheet').options[0].textContent, 'Stage 1');
  r.$('sheet-worksheet').value = '99'; r.$('sheet-worksheet').dispatchEvent(new r.window.Event('change')); assert.equal(r.picker.worksheet, '99');
  r.$('sheet-worksheet').value = '__manual__'; r.$('sheet-worksheet').dispatchEvent(new r.window.Event('change')); assert.equal(r.$('manual-worksheet-field').hidden, false);
  r.$('sheet-worksheet-manual').value = 'Custom tab'; r.$('sheet-worksheet-manual').dispatchEvent(new r.window.Event('input')); assert.equal(r.picker.worksheet, 'Custom tab');
  assert.ok(r.invalidations() >= 3);
});
test('reverse dragging selects a rectangle, Cancel leaves the form untouched, and Use range only edits the draft', async t => {
  const r = await fixture(t); r.$('sheet-range').value = 'A1:D4'; await r.picker.openRange();
  const cell = address => r.$('range-grid').querySelector(`[data-address="${address}"]`);
  assert.equal(r.$('range-grid').querySelector('b'), null);
  cell('D4').dispatchEvent(new r.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  cell('B2').dispatchEvent(new r.window.MouseEvent('pointermove', { bubbles: true })); r.$('range-grid').dispatchEvent(new r.window.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(r.$('selected-range').value, 'B2:D4'); assert.equal(r.$('range-grid').querySelectorAll('[aria-selected="true"]').length, 9);
  assert.equal(r.$('sheet-range').value, 'A1:D4'); r.$('cancel-range').click(); assert.equal(r.$('sheet-range').value, 'A1:D4');
  await r.picker.openRange(); cell('B2').dispatchEvent(new r.window.MouseEvent('pointerdown', { bubbles: true, button: 0 })); r.picker.endDrag();
  cell('B2').dispatchEvent(new r.window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
  assert.equal(r.$('selected-range').value, 'B2:C2'); r.$('use-range').click(); assert.equal(r.$('sheet-range').value, 'B2:C2');
  assert.equal(r.$('range-dialog').open, false); assert.ok(r.calls.every(call => ['/data/sheets/test', '/data/sheets/worksheets'].includes(call.url)));
});
test('window navigation uses the selected tab and cell addresses beyond Z; invalid windows cannot be applied', async t => {
  const r = await fixture(t); r.$('sheet-worksheet').value = '99'; await r.picker.openRange();
  r.$('range-window').value = 'AA100:AF110'; await r.picker.loadWindow();
  assert.equal(r.calls.at(-1).body.settings.worksheet, '99'); assert.equal(r.$('range-grid').querySelector('td').dataset.address, 'AA100');
  r.picker.moveWindow(0, 1); await flush(); assert.equal(r.$('range-window').value, 'AA111:AF121');
  const reads = r.calls.length; r.$('range-window').value = 'A1:ZZ999'; await r.picker.loadWindow(); assert.equal(r.calls.length, reads); assert.equal(r.$('use-range').disabled, true);
});
test('used connections retain their saved tab and lock target changes; stale metadata cannot replace a later form', async t => {
  let release;
  const r = await fixture(t, async () => new Promise(resolve => { release = resolve; }));
  const first = release; r.picker.reset({ worksheet: 'Saved name', locked: true });
  first({ worksheets: [{ id: '123', name: 'Old request' }] }); await flush();
  assert.equal(r.$('sheet-worksheet').options[0].textContent, 'Tab Saved name');
  release({ worksheets: [{ id: '42', name: 'Saved name' }] }); await flush();
  assert.equal(r.$('sheet-worksheet').value, '42'); assert.equal(r.picker.worksheet, 'Saved name'); assert.equal(r.$('sheet-worksheet').disabled, true); assert.equal(r.$('select-range').disabled, true);
  await r.picker.openRange(); assert.equal(r.$('range-dialog').open, false);
});

test('worksheet discovery failure leaves manual tab selection available', async t => {
  const r = await fixture(t, async () => { throw new Error('Worksheet list unavailable'); });
  assert.match(r.$('sheet-tabs-status').textContent, /Worksheet list unavailable/); assert.equal(r.$('load-worksheets').disabled, false);
  r.$('sheet-worksheet').value = '__manual__'; r.$('sheet-worksheet').dispatchEvent(new r.window.Event('change'));
  r.$('sheet-worksheet-manual').value = 'Other tab'; assert.equal(r.picker.worksheet, 'Other tab'); assert.equal(r.$('manual-worksheet-field').hidden, false);
});

test('a closed picker ignores a late preview response and does not modify the draft', async t => {
  let release;
  const r = await fixture(t, async url => url.endsWith('/worksheets') ? { worksheets: [{ id: '42', name: 'Stage 1' }] } : new Promise(resolve => { release = resolve; }));
  const pending = r.picker.openRange(); await flush(); r.$('cancel-range').click();
  release({ rows: [[{ address: 'A1', value: 'Late data', usable: true }]] }); await pending;
  assert.equal(r.$('range-grid').children.length, 0); assert.equal(r.$('sheet-range').value, 'A1:D4'); assert.equal(r.$('range-dialog').open, false);
});
