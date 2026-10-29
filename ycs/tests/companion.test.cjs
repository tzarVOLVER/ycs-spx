'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  http = require('node:http');
const express = require('express'),
  { Server } = require('socket.io');
const client = require(
  path.join(path.dirname(require.resolve('socket.io')), '../client-dist/socket.io.js')
);
const register = require('../index.cjs'),
  { fixture } = require('./playback.test.cjs'),
  contract = require('../public/companion-contract.js');
async function setup(t, { apiKey, duplicate = false } = {}) {
  const f = await fixture(t),
    app = express();
  app.use(express.json());
  if (duplicate) f.stages.push({ id: 'duplicate', project: 'Stage1', rundown: 'Show' });
  const config = {
    general: { dataroot: f.root, username: '' },
    ycs: {
      enabled: true,
      dataFile: path.join(f.root, 'sources.json'),
      stages: f.stages,
      slots: { ticker: { order: 10 }, 'lower-third': { order: 20 } },
      ...(apiKey ? { apiKey } : {})
    }
  };
  const playback = register(app, config, { auth: { CheckLogin: (req, res, next) => next() } });
  const server = http.createServer(app),
    io = new Server(server);
  playback.attachSockets(io);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await playback.sources.ready;
  t.after(async () => {
    playback.close();
    await new Promise((resolve) => io.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (target, body = {}, headers = {}) =>
    fetch(base + target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  return { ...f, playback, base, post };
}
test('project/rundown item commands use saved values and isolate outputs without guessed IDs', async (t) => {
  const r = await setup(t),
    show = await r.repository.read('stage-1');
  show.templates[0].itemID = '1799991234';
  show.templates[0].steps = 2;
  await r.repository.write('stage-1', show);
  const url = (action) => contract.command('Stage1', 'Show', '1799991234', action).path;
  for (const action of ['play', 'play', 'update', 'continue'])
    assert.equal((await r.post(url(action))).status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics[0].id, '1799991234');
  assert.equal(r.playback.snapshot('stage-2', 'program').graphics.length, 0);
  assert.equal((await r.post(url('stop'))).status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  assert.equal((await r.post(url('update'))).status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  assert.equal((await r.post(url('toggle'))).status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 1);
  assert.equal((await r.post(url('toggle'))).status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  assert.equal((await r.post(url('preview'))).status, 200);
  assert.equal(r.playback.snapshot('stage-1', 'preview').selected, '1799991234');
  assert.equal((await r.post('/api/Stage1/Show/ticker/play')).status, 404);
  // Existing editor/control addresses remain compatible.
  assert.equal((await r.post('/api/ycs/stages/stage-2/graphics/ticker/play')).status, 200);
});
test('item commands enforce auth, origin, exact configured scope and saved-data-only requests; exports are gone', async (t) => {
  const r = await setup(t, { apiKey: 'test-only' }),
    url = '/api/Stage1/Show/ticker/play',
    auth = { Authorization: 'Bearer test-only' };
  assert.equal((await r.post(url)).status, 401);
  assert.equal((await r.post(url, {}, { ...auth, Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await r.post(url, { fields: [] }, auth)).status, 400);
  assert.equal((await r.post('/api/Stage1/Wrong/ticker/play', {}, auth)).status, 404);
  assert.equal((await r.post('/api/NewProject/Show/ticker/play', {}, auth)).status, 404);
  assert.equal((await r.post('/api/Stage1/Show/ticker/clear', {}, auth)).status, 400);
  assert.equal((await r.post(url, {}, auth)).status, 200);
  for (const target of ['/api/ycs/companion/export', '/api/ycs/stages/stage-1/companion'])
    assert.equal((await fetch(r.base + target, { headers: auth })).status, 404);
  const ambiguous = await setup(t, { duplicate: true });
  assert.equal((await ambiguous.post(url)).status, 409);
  assert.equal(
    contract.command('Stage1', 'Show', 'ticker', 'focus').path,
    '/api/Stage1/Show/ticker/select'
  );
  for (const id of ['../bad', 'bad/name', '', null])
    assert.throws(() => contract.command(id, 'Show', 'ticker', 'play'));
});
test('select/focus deliver only to matching open controllers, without writes or output changes', async (t) => {
  const r = await setup(t),
    sockets = [];
  t.after(() => sockets.forEach((s) => s.disconnect()));
  const connect = async (stage, controller) => {
    const socket = client(r.base + '/ycs-playback', {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    await new Promise((resolve) => {
      socket.once('state', resolve);
      socket.emit('subscribe', { stage, modes: ['preview'], controller });
    });
    return socket;
  };
  const [operator, other, output] = await Promise.all([
    connect('stage-1', true),
    connect('stage-2', true),
    connect('stage-1', false)
  ]);
  let foreign = 0,
    renderer = 0;
  other.on('focus', () => foreign++);
  output.on('focus', () => renderer++);
  await r.playback.command('stage-1', 'ticker', 'preview', [
    { field: 'f5', value: 'UNSAVED SERVER PREVIEW' }
  ]);
  const before = await fs.readFile(r.repository.stage('stage-1').file, 'utf8');
  const program = r.playback.snapshot('stage-1', 'program'),
    preview = r.playback.snapshot('stage-1', 'preview');
  for (const action of ['select', 'focus']) {
    const event = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Focus event timeout')), 2000);
      operator.once('focus', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    assert.equal((await r.post('/api/Stage1/Show/lower-third/' + action)).status, 200);
    assert.deepEqual(await event, { stage: 'stage-1', selected: 'lower-third' });
  }
  assert.equal(await fs.readFile(r.repository.stage('stage-1').file, 'utf8'), before);
  assert.deepEqual(r.playback.snapshot('stage-1', 'program'), program);
  assert.deepEqual(r.playback.snapshot('stage-1', 'preview'), preview);
  assert.equal(foreign, 0);
  assert.equal(renderer, 0);
  assert.equal((await r.post('/api/Stage1/Show/missing/select')).status, 404);
  const unslotted = await r.repository.read('stage-1');
  delete unslotted.templates[1].ycsSlot;
  await r.repository.write('stage-1', unslotted);
  assert.equal((await r.post('/api/Stage1/Show/lower-third/select')).status, 200);
  assert.equal((await r.post('/api/Stage1/Show/lower-third/play')).status, 422);
});
