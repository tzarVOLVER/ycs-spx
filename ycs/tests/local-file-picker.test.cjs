'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { loadDataManagerScripts } = require('./helpers/browser.cjs');
test('file selector ignores closed and outdated list responses and preserves a missing selected target', async (t) => {
  const dom = new JSDOM(
      await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'),
      { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only' }
    ),
    window = dom.window;
  window.structuredClone = structuredClone;
  t.after(() => window.close());
  await loadDataManagerScripts(window);
  const $ = (id) => window.document.getElementById(id);
  let type = 'local-json',
    changed = 0;
  const pending = [],
    picker = new window.YCSLocalFilePicker({
      request: () => new Promise((resolve) => pending.push(resolve)),
      invalidate: () => changed++,
      getType: () => type
    });
  $('connection-dialog').open = true;
  picker.reset({ file: 'saved.json', locked: true });
  type = 'local-csv';
  picker.reset();
  pending[0]({ folder: 'C:/Data', files: [{ name: 'saved.json', type: 'local-json' }] });
  pending[1]({ folder: 'C:/Data', files: [{ name: 'stories.csv', type: 'local-csv' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    [...$('local-file').options].map((option) => option.value),
    ['', 'stories.csv']
  );
  assert.equal(changed, 0);
  type = 'local-json';
  picker.reset({ file: 'missing.json', locked: true });
  pending[2]({ folder: 'C:/Data', files: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal($('local-file').value, 'missing.json');
  assert.equal($('local-file').disabled, true);
  assert.match($('local-file').selectedOptions[0].textContent, /missing/);
  picker.reset();
  const before = $('local-file-status').textContent;
  $('connection-dialog').open = false;
  $('connection-dialog').dispatchEvent(new window.Event('close'));
  pending[3]({ folder: 'Wrong folder', files: [{ name: 'late.json', type: 'local-json' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal($('local-file-status').textContent, before);
  assert.equal($('local-file').options.length, 0);
  picker.dispose();
});
