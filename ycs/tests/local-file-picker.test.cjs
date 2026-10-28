const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { loadDataManagerScripts } = require('./helpers/browser.cjs');
async function setup(t, request) {
  const dom = new JSDOM(
      await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'),
      { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only' }
    ),
    window = dom.window;
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  t.after(() => window.close());
  await loadDataManagerScripts(window);
  let changed = 0;
  const $ = (id) => window.document.getElementById(id);
  $('connection-dialog').open = true;
  const picker = new window.YCSLocalFilePicker({
    request,
    invalidate: () => changed++,
    getType: () => 'local-json'
  });
  return { window, $, picker, changed: () => changed };
}
const locations = [
  { id: 'default', label: 'Local data', path: 'C:/Data' },
  { id: 'shared', label: 'Production data', path: 'C:/Shared' }
];
const response = (location, directory, entries) => ({
  location,
  label: location === 'shared' ? 'Production data' : 'Local data',
  root: location === 'shared' ? 'C:/Shared' : 'C:/Data',
  directory,
  entries
});
test('server browser navigates, filters and uses a nested file only on explicit confirmation; Cancel leaves the form unchanged', async (t) => {
  const r = await setup(t, async (url, body) =>
    url.endsWith('/locations')
      ? { locations }
      : response(
          body.location,
          body.directory,
          body.directory
            ? [{ name: 'round.json', path: 'Orlando/round.json', kind: 'file', type: 'local-json' }]
            : [
                { name: 'Orlando', path: 'Orlando', kind: 'directory' },
                { name: 'unused.json', path: 'unused.json', kind: 'file', type: 'local-json' }
              ]
        )
  );
  await r.picker.reset({ file: 'manual.json' });
  await r.picker.open();
  assert.equal(r.$('local-file').value, 'manual.json');
  await r.$('file-browser-entries').querySelector('[aria-label="Open folder Orlando"]').onclick();
  r.$('file-browser-entries').querySelector('[aria-label="Select file round.json"]').click();
  assert.equal(r.$('file-browser-selection').value, 'Orlando/round.json');
  assert.equal(r.changed(), 0);
  r.$('cancel-file-browser').click();
  assert.equal(r.$('local-file').value, 'manual.json');
  await r.picker.open();
  r.$('file-browser-location').value = 'shared';
  await r.picker.browse('Orlando');
  r.$('file-browser-search').value = 'round';
  r.$('file-browser-search').oninput();
  assert.equal(r.$('file-browser-entries').children.length, 1);
  r.$('file-browser-entries').querySelector('button').click();
  r.$('use-server-file').click();
  assert.equal(r.$('local-file').value, 'Orlando/round.json');
  assert.equal(r.$('local-location').value, 'shared');
  assert.equal(r.changed(), 1);
  assert.equal(r.$('file-browser-dialog').open, false);
});
test('late folder responses and closed-dialog results cannot restore old contents or change a selection', async (t) => {
  const pending = [],
    r = await setup(t, (url, body) =>
      url.endsWith('/locations')
        ? Promise.resolve({ locations })
        : new Promise((resolve) => pending.push({ body, resolve }))
    );
  await r.picker.reset({ file: 'saved.json' });
  const open = r.picker.open();
  await new Promise((resolve) => setImmediate(resolve));
  const newer = r.picker.browse('Orlando');
  pending[1].resolve(
    response('default', 'Orlando', [
      { name: 'round.json', path: 'Orlando/round.json', kind: 'file', type: 'local-json' }
    ])
  );
  await newer;
  pending[0].resolve(
    response('default', '', [
      { name: 'old.json', path: 'old.json', kind: 'file', type: 'local-json' }
    ])
  );
  await open;
  assert.match(r.$('file-browser-entries').textContent, /round.json/);
  assert.doesNotMatch(r.$('file-browser-entries').textContent, /old.json/);
  const late = r.picker.browse('Late');
  r.$('cancel-file-browser').click();
  pending[2].resolve(
    response('default', 'Late', [
      { name: 'late.json', path: 'Late/late.json', kind: 'file', type: 'local-json' }
    ])
  );
  await late;
  assert.equal(r.$('local-file').value, 'saved.json');
  assert.equal(r.$('use-server-file').disabled, true);
  assert.equal(r.changed(), 0);
  r.picker.dispose();
});
test('a missing configured location remains visible, used targets stay locked and metadata ignores a closed parent', async (t) => {
  let complete;
  const r = await setup(t, () => new Promise((resolve) => (complete = resolve)));
  const loading = r.picker.reset({ file: 'missing.json', location: 'removed', locked: true });
  r.$('connection-dialog').close();
  complete({ locations });
  await loading;
  assert.equal(r.$('local-location').value, 'removed');
  assert.equal(r.$('local-file').value, 'missing.json');
  await r.picker.open();
  assert.equal(r.$('file-browser-dialog').open, false);
  r.picker.dispose();
});
