'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { JSDOM } = require('jsdom');
const register = require('../index.cjs');
const { fixture } = require('./playback.test.cjs');
const { loadDataManagerScripts } = require('./helpers/browser.cjs');

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Expected UI state did not arrive');
}
async function setup(t, { apiKey } = {}) {
  const f = await fixture(t),
    localRoot = path.join(f.root, 'local-files');
  await fs.mkdir(localRoot);
  await fs.writeFile(
    path.join(localRoot, 'round.json'),
    JSON.stringify({ round: '<b>ROUND 1</b>', stories: [{ subtopic: 'Local story' }] })
  );
  await fs.writeFile(
    path.join(localRoot, 'stories.csv'),
    'Published;Topic;Subtopic\nTRUE;News;CSV story'
  );
  const sharedRoot = path.join(f.root, 'shared');
  await fs.mkdir(path.join(sharedRoot, 'Orlando'), { recursive: true });
  await fs.writeFile(
    path.join(sharedRoot, 'Orlando', 'round.json'),
    JSON.stringify({ round: 'SHARED ROUND' })
  );
  const app = express();
  app.use(express.json());
  const playback = register(
    app,
    {
      general: { dataroot: f.root, username: '' },
      ycs: {
        enabled: true,
        stages: f.stages,
        dataFile: path.join(f.root, 'sources.json'),
        localDataRoot: localRoot,
        localDataLocations: [{ id: 'production', label: 'Production data', path: sharedRoot }],
        ...(apiKey ? { apiKey } : {}),
        slots: { ticker: { order: 10 } }
      }
    },
    { auth: { CheckLogin: (req, res, next) => next() } }
  );
  t.after(() => playback.close());
  await playback.sources.ready;
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body, headers = {}) =>
    fetch(base + '/api/ycs' + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  return { ...f, playback, base, post, localRoot };
}

test('local file HTTP routes enforce origin and path validation, test without saving and accept mapped CSV/JSON sources', async (t) => {
  const r = await setup(t),
    before = await fs.readFile(path.join(r.root, 'sources.json'), 'utf8');
  const files = await fetch(r.base + '/api/ycs/data/local/files').then((response) =>
    response.json()
  );
  assert.equal(files.files.length, 2);
  assert.equal(files.folder, r.localRoot);
  const settings = { file: 'round.json', refreshSeconds: 5 };
  assert.equal(
    (
      await r.post(
        '/data/local/test',
        { type: 'local-json', settings },
        { Origin: 'https://untrusted.example' }
      )
    ).status,
    403
  );
  assert.equal(
    (
      await r.post('/data/local/test', {
        type: 'local-json',
        settings: { ...settings, file: '../outside.json' }
      })
    ).status,
    400
  );
  assert.equal((await r.post('/data/local/test', { type: 'json-api', settings })).status, 400);
  const tested = await r.post('/data/local/test', { type: 'local-json', settings });
  assert.equal(tested.status, 200);
  assert.equal((await tested.json()).data.round, '<b>ROUND 1</b>');
  assert.equal(await fs.readFile(path.join(r.root, 'sources.json'), 'utf8'), before);
  const result = await (
    await r.post('/data/connections', {
      type: 'local-json',
      label: 'Local round',
      settings,
      revision: 0
    })
  ).json();
  assert.ok(result.connectionId);
  assert.equal(result.snapshot.connections[result.connectionId].type, 'local-json');
  const invalid = await r.post('/data/mappings/stage-1/ticker', {
    revision: result.snapshot.revision,
    edits: [
      {
        field: 'f5',
        scope: 'override',
        binding: { connection: result.connectionId, selection: { kind: 'cell', cell: 'A1' } }
      }
    ]
  });
  assert.equal(invalid.status, 400);
  const mapped = await r.post('/data/mappings/stage-1/ticker', {
    revision: result.snapshot.revision,
    edits: [
      {
        field: 'f5',
        scope: 'override',
        binding: { connection: result.connectionId, selection: { kind: 'json', pointer: '/round' } }
      }
    ]
  });
  assert.equal(mapped.status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
});

test('Data Manager selects server files, tests/saves both formats and exposes existing mapping without playout', async (t) => {
  const r = await setup(t),
    dom = new JSDOM(
      await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'),
      { url: r.base + '/ycs/data-manager', runScripts: 'outside-only' }
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
  let poll;
  window.setInterval = (callback) => {
    poll = callback;
    return 1;
  };
  window.clearInterval = () => {};
  const requests = [];
  window.fetch = (url, options) => {
    requests.push({ url, options });
    return fetch(r.base + url, options);
  };
  t.after(() => {
    window.dispatchEvent(new window.Event('pagehide'));
    window.close();
  });
  await loadDataManagerScripts(window);
  window.eval(await fs.readFile(path.join(__dirname, '../public/data-manager.js'), 'utf8'));
  await flush();
  const $ = (id) => window.document.getElementById(id),
    change = (id, value) => {
      $(id).value = value;
      $(id).dispatchEvent(new window.Event('change'));
    };
  $('add-connection').click();
  change('connection-type', 'local-json');
  await until(() => $('local-file-status').textContent.startsWith('SPX server location:'));
  assert.match($('local-file-status').textContent, /SPX server location/);
  assert.equal($('local-location').value, 'default');
  assert.equal($('sheet-url').disabled, true);
  $('sheet-label').value = 'Local round';
  change('local-file', 'round.json');
  await $('test-sheet').onclick();
  assert.equal($('save-sheet').disabled, false);
  assert.match($('sheet-preview').textContent, /<b>ROUND 1<\/b>/);
  assert.equal($('sheet-preview').querySelector('b'), null);
  assert.equal($('connection-form').checkValidity(), true);
  await $('connection-form').onsubmit(new window.Event('submit', { cancelable: true }));
  await flush();
  assert.match($('connections').textContent, /round.json/);
  assert.equal($('connection-dialog').open, false);
  $('add-connection').click();
  change('connection-type', 'local-csv');
  await until(() => $('local-file-status').textContent.startsWith('SPX server location:'));
  assert.equal($('local-file').tagName, 'INPUT');
  assert.equal($('csv-delimiter-field').hidden, false);
  $('sheet-label').value = 'Local stories';
  change('local-file', 'stories.csv');
  change('csv-delimiter', ';');
  await $('test-sheet').onclick();
  assert.match($('sheet-preview').textContent, /CSV story/);
  assert.equal($('save-sheet').disabled, false);
  await $('connection-form').onsubmit(new window.Event('submit', { cancelable: true }));
  await flush();
  const snapshot = r.playback.sources.snapshot(),
    json = Object.entries(snapshot.connections).find(([, value]) => value.type === 'local-json'),
    csv = Object.entries(snapshot.connections).find(([, value]) => value.type === 'local-csv');
  assert.ok(json);
  assert.ok(csv);
  assert.equal(csv[1].settings.delimiter, ';');
  const workspaceSources = $('mapping-source');
  assert.ok([...workspaceSources.options].some((option) => option.value === csv[0]));
  change('mapping-source', csv[0]);
  assert.equal($('browse-source').hidden, false);
  assert.match($('source-context').textContent, /stories.csv/);
  change('mapping-source', json[0]);
  assert.equal($('browse-source').hidden, true);
  assert.match($('source-values').textContent, /round/);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  assert.ok(
    requests.every((request) => !request.url.endsWith('/play') && !request.url.endsWith('/update'))
  );
});

test('configured server browser routes enforce access and path boundaries without changing connections or program', async (t) => {
  const r = await setup(t),
    before = await fs.readFile(path.join(r.root, 'sources.json'), 'utf8');
  const locations = await fetch(r.base + '/api/ycs/data/local/locations').then((response) =>
    response.json()
  );
  assert.deepEqual(
    locations.locations.map((location) => location.id),
    ['default', 'production']
  );
  const root = await r.post('/data/local/browse', {
    location: 'production',
    directory: '',
    type: 'local-json'
  });
  assert.equal(root.status, 200);
  assert.equal((await root.json()).entries[0].name, 'Orlando');
  const folder = await (
    await r.post('/data/local/browse', {
      location: 'production',
      directory: 'Orlando',
      type: 'local-json'
    })
  ).json();
  assert.equal(folder.entries[0].path, 'Orlando/round.json');
  for (const body of [
    { location: 'unknown' },
    { directory: '../outside' },
    { directory: 'C:/outside' },
    { directory: '\\\\OTHER\\share' },
    { directory: 'Orlando', type: 'text' }
  ])
    assert.equal((await r.post('/data/local/browse', body)).status, 400);
  assert.equal(
    (
      await r.post(
        '/data/local/browse',
        { location: 'production' },
        { Origin: 'https://untrusted.example' }
      )
    ).status,
    403
  );
  assert.equal(await fs.readFile(path.join(r.root, 'sources.json'), 'utf8'), before);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  const tested = await (
    await r.post('/data/local/test', {
      type: 'local-json',
      settings: { location: 'production', file: 'Orlando/round.json', refreshSeconds: 5 }
    })
  ).json();
  assert.equal(tested.data.round, 'SHARED ROUND');
});

test('server location metadata and browser require the existing API authorization', async (t) => {
  const r = await setup(t, { apiKey: 'browser-test-key' });
  assert.equal((await fetch(r.base + '/api/ycs/data/local/locations')).status, 401);
  assert.equal((await r.post('/data/local/browse', {})).status, 401);
  assert.equal(
    (await r.post('/data/local/browse', {}, { Authorization: 'Bearer browser-test-key' })).status,
    200
  );
});
