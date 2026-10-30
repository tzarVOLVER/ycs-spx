'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
test('path field preserves legacy target identity, resolves its display and ignores stale metadata', async (t) => {
  const dom = new JSDOM('<input id="local-file"><p id="local-file-status"></p>', {
    runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  dom.window.eval(await fs.readFile(path.join(__dirname, '../public/local-file-field.js'), 'utf8'));
  let release;
  const field = new dom.window.YCSLocalFileField({
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      })
  });
  const input = dom.window.document.getElementById('local-file');
  const pending = field.reset({ file: 'Orlando/round.json', location: 'production', locked: true });
  release({ locations: [{ id: 'production', path: 'C:\\Production' }] });
  await pending;
  assert.equal(input.value, 'C:\\Production/Orlando/round.json');
  assert.equal(input.readOnly, true);
  assert.equal(
    JSON.stringify(field.settings()),
    JSON.stringify({ file: 'Orlando/round.json', location: 'production' })
  );
  field.reset({ file: 'C:\\Data\\round.json' });
  input.value = '\\\\DATA-PC\\Share\\round.json';
  assert.equal(JSON.stringify(field.settings()), JSON.stringify({ file: input.value }));
  const stale = field.reset({ file: 'round.json' });
  field.reset({ file: 'D:\\New\\round.json' });
  release({ locations: [{ id: 'default', path: 'C:\\Old' }] });
  await stale;
  assert.equal(input.value, 'D:\\New\\round.json');
  const edited = field.reset({ file: 'old.json' });
  input.value = 'D:\\Edited\\round.json';
  release({ locations: [{ id: 'default', path: 'C:\\Old' }] });
  await edited;
  assert.equal(input.value, 'D:\\Edited\\round.json');
  assert.equal(JSON.stringify(field.settings()), JSON.stringify({ file: input.value }));
});
