'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./playback.test.cjs');

test('toggle follows actual program, uses saved data on Play and isolates stage/slot', async t => {
  const { playback, repository } = await fixture(t);
  await playback.command('stage-2', 'ticker', 'play');
  const otherStage = playback.snapshot('stage-2', 'program');
  await playback.command('stage-1', 'lower-third', 'play');
  await playback.command('stage-1', 'ticker', 'preview', [{ field: 'f5', value: 'PREVIEW ONLY' }]);
  await playback.command('stage-1', 'ticker', 'save', [{ field: 'f5', value: 'SAVED ROUND' }]);
  let result = await playback.command('stage-1', 'ticker', 'toggle');
  assert.deepEqual(result.graphics.map(item => item.id), ['ticker', 'lower-third']);
  assert.equal(result.graphics[0].data.f5, 'SAVED ROUND');
  assert.equal((await repository.read('stage-1')).templates[0].onair, 'true');
  // Changes from another controller are reflected on the very next press.
  await playback.command('stage-1', 'ticker', 'stop');
  result = await playback.command('stage-1', 'ticker', 'toggle');
  assert.ok(result.graphics.some(item => item.id === 'ticker'));
  result = await playback.command('stage-1', 'ticker', 'toggle');
  assert.deepEqual(result.graphics.map(item => item.id), ['lower-third']);
  assert.equal((await repository.read('stage-1')).templates[0].onair, 'false');
  assert.deepEqual(playback.snapshot('stage-2', 'program'), otherStage);
  // Stale persisted flags from before a server restart cannot stop a graphic
  // which is not in this server's current program composition.
  const saved = await repository.read('stage-1'); saved.templates[0].onair = 'true'; await repository.write('stage-1', saved);
  result = await playback.command('stage-1', 'ticker', 'toggle');
  assert.ok(result.graphics.some(item => item.id === 'ticker'));
});

test('concurrent toggles serialize and failed writes never flip program', async t => {
  const { playback, repository } = await fixture(t);
  await Promise.all(Array.from({ length: 10 }, () => playback.command('stage-1', 'ticker', 'toggle')));
  assert.equal(playback.snapshot('stage-1', 'program').graphics.length, 0);
  await Promise.all(Array.from({ length: 3 }, () => playback.command('stage-1', 'ticker', 'toggle')));
  const before = playback.snapshot('stage-1', 'program'); assert.equal(before.graphics.length, 1);
  const write = repository.write; repository.write = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(playback.command('stage-1', 'ticker', 'toggle'), /Disk unavailable/);
  assert.deepEqual(playback.snapshot('stage-1', 'program'), before);
  repository.write = write;
  await playback.command('stage-1', 'ticker', 'toggle');
  assert.equal(playback.snapshot('stage-1', 'program').graphics.length, 0);
  await assert.rejects(playback.command('stage-1', 'missing', 'toggle'), /Unknown graphic/);
  assert.equal(playback.snapshot('stage-1', 'program').graphics.length, 0);
});
