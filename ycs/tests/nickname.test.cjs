'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { fixture } = require('./playback.test.cjs');
const { Playback } = require('../playback.cjs');
const register = require('../index.cjs');

test('nicknames persist independently of IDs, fields, on-air state and preview; stale edits conflict', async (t) => {
  const { repository, playback } = await fixture(t);
  await playback.command('stage-1', 'ticker', 'play');
  await playback.command('stage-1', 'ticker', 'preview', [
    { field: 'f5', value: 'UNSAVED PREVIEW' }
  ]);
  const program = playback.snapshot('stage-1', 'program'),
    preview = playback.snapshot('stage-1', 'preview'),
    before = repository.item(await repository.read('stage-1'), 'ticker'),
    other = await fs.readFile(repository.stage('stage-2').file, 'utf8');
  assert.deepEqual(await playback.rename('stage-1', 'ticker', '  Player name  ', 0), {
    nickname: 'Player name',
    editorRevision: 1
  });
  const item = repository.item(await repository.read('stage-1'), 'ticker');
  assert.deepEqual(item.DataFields, before.DataFields);
  assert.equal(item.itemID, 'ticker');
  assert.equal(item.ycsNickname, 'Player name');
  assert.equal(item.relpath, before.relpath);
  assert.deepEqual(playback.snapshot('stage-1', 'program'), program);
  assert.deepEqual(playback.snapshot('stage-1', 'preview'), preview);
  assert.equal(await fs.readFile(repository.stage('stage-2').file, 'utf8'), other);
  const restarted = new Playback(repository, {
    ticker: { order: 10 },
    'lower-third': { order: 20 }
  });
  assert.equal((await restarted.editor('stage-1', 'ticker')).nickname, 'Player name');
  assert.equal((await restarted.catalog('stage-1'))[0].title, 'Player name');
  await assert.rejects(
    playback.rename('stage-1', 'ticker', 'Stale', 0),
    (error) => error.status === 409
  );
  await assert.rejects(
    playback.command('stage-1', 'ticker', 'save', undefined, { revision: 0 }),
    (error) => error.status === 409
  );
  await playback.rename('stage-1', 'ticker', '', 1);
  assert.equal(repository.item(await repository.read('stage-1'), 'ticker').ycsNickname, undefined);
});

test('nickname validation, simultaneous edits and failed writes cannot overwrite saved names or program', async (t) => {
  const { repository, playback } = await fixture(t);
  for (const name of [null, {}, 'x'.repeat(101), 'two\nlines'])
    assert.throws(
      () => playback.rename('stage-1', 'ticker', name, 0),
      (error) => error.status === 422
    );
  assert.throws(() => playback.rename('stage-1', 'ticker', 'Name', undefined), /revision/);
  const results = await Promise.allSettled([
    playback.rename('stage-1', 'ticker', 'First', 0),
    playback.rename('stage-1', 'ticker', 'Second', 0)
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.status, 409);
  const before = await fs.readFile(repository.stage('stage-1').file, 'utf8');
  const write = repository.write;
  repository.write = async () => {
    throw new Error('Disk unavailable');
  };
  await assert.rejects(playback.rename('stage-1', 'ticker', 'Failed', 1), /Disk/);
  repository.write = write;
  assert.equal(await fs.readFile(repository.stage('stage-1').file, 'utf8'), before);
  assert.equal(playback.snapshot('stage-1', 'program').graphics.length, 0);
});

test('nickname HTTP route requires API access, same origin and the loaded editor revision', async (t) => {
  const f = await fixture(t),
    app = express();
  app.use(express.json());
  const playback = register(
    app,
    {
      general: { dataroot: f.root, username: '' },
      ycs: {
        enabled: true,
        stages: f.stages,
        slots: { ticker: { order: 10 } },
        dataFile: path.join(f.root, 'sources.json'),
        apiKey: 'nickname-test-key'
      }
    },
    { auth: { CheckLogin: (req, res, next) => next() } }
  );
  t.after(() => playback.close());
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint =
    'http://127.0.0.1:' +
    server.address().port +
    '/api/ycs/stages/stage-1/graphics/ticker/nickname';
  const post = (body, headers = {}) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  assert.equal((await post({ nickname: 'Name', revision: 0 })).status, 401);
  const auth = { Authorization: 'Bearer nickname-test-key' };
  assert.equal(
    (
      await post(
        { nickname: 'Name', revision: 0 },
        { ...auth, Origin: 'https://untrusted.example' }
      )
    ).status,
    403
  );
  const result = await post({ nickname: '<b>Literal nickname</b>', revision: 0 }, auth);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).nickname, '<b>Literal nickname</b>');
  assert.equal((await post({ nickname: 'Old editor', revision: 0 }, auth)).status, 409);
  assert.equal(playback.snapshot('stage-1', 'program').graphics.length, 0);
});
