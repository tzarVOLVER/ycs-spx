'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('./playback.test.cjs');
const { DataSources } = require('../data.cjs');
const { Playback } = require('../playback.cjs');
const { Renderers } = require('../renderers.cjs');

async function linkedFixture(t) {
  const result = await fixture(t);
  const sources = new DataSources(path.join(result.root, 'sources.json'), result.stages);
  await sources.ready;
  result.playback.sources = sources;
  const publish = async (value, stage = 'stage-1') => {
    await sources.updateSource(`test.${stage}.currentRound`, value, sources.snapshot().revision);
    await Promise.all(result.stages.map(stage => result.playback.refreshLinks(stage.id)));
  };
  return { ...result, sources, publish };
}
const options = (mode, manual = 'MANUAL FALLBACK') => ({ links: { f5: { mode, manual } } });
const round = (playback, mode = 'program', stage = 'stage-1') => playback.snapshot(stage, mode).graphics.find(item => item.id === 'ticker')?.data.f5;

test('link preview, Save and manual overrides stay separate from committed live source bindings', async t => {
  const { playback, repository, sources, publish } = await linkedFixture(t);
  await playback.command('stage-1', 'ticker', 'play');
  await playback.command('stage-2', 'ticker', 'play');
  await playback.command('stage-1', 'lower-third', 'play');
  const lower = playback.snapshot('stage-1', 'program').graphics.find(item => item.id === 'lower-third');
  await playback.command('stage-1', 'ticker', 'preview', undefined, options('linked'));
  assert.equal(round(playback, 'preview'), 'SWISS ROUND 11 OF 15');
  assert.equal(round(playback), 'STAGE 1 ROUND');
  await playback.command('stage-1', 'ticker', 'save', [{ field: 'f5', value: 'DISPLAYED SOURCE TEXT' }], options('linked'));
  assert.equal(round(playback), 'STAGE 1 ROUND');
  assert.equal((await repository.read('stage-1')).templates[0].DataFields.find(field => field.field === 'f5').value, 'MANUAL FALLBACK');
  await playback.command('stage-1', 'ticker', 'update');
  await publish('LINKED ROUND 12');
  assert.equal(round(playback), 'LINKED ROUND 12');
  assert.equal(round(playback, 'program', 'stage-2'), 'STAGE 2 ROUND');
  await playback.command('stage-1', 'ticker', 'preview', [{ field: 'f5', value: 'CUSTOM FINAL' }], options('manual', 'CUSTOM FINAL'));
  await publish('LINKED ROUND 13');
  assert.equal(round(playback), 'LINKED ROUND 13');
  assert.equal(round(playback, 'preview'), 'CUSTOM FINAL');
  await playback.command('stage-1', 'ticker', 'update', [{ field: 'f5', value: 'CUSTOM FINAL' }], options('manual', 'CUSTOM FINAL'));
  await publish('LINKED ROUND 14');
  assert.equal(round(playback), 'CUSTOM FINAL');
  assert.deepEqual(playback.snapshot('stage-1', 'program').graphics.find(item => item.id === 'lower-third'), lower);
  assert.equal((await playback.editor('stage-1', 'ticker')).links.f5.manual, 'CUSTOM FINAL');
  assert.equal(sources.snapshot().health, 'ok');
});

test('mapping edits do not rebind program until Update; shared data can be assigned per stage', async t => {
  const { playback, sources, publish } = await linkedFixture(t);
  await playback.command('stage-1', 'ticker', 'play', undefined, options('linked'));
  await sources.updateMapping({ stage: 'stage-1', graphic: 'ticker', field: 'f5', source: 'test.stage-2.currentRound' }, sources.snapshot().revision);
  await publish('STAGE TWO SOURCE', 'stage-2');
  assert.equal(round(playback), 'SWISS ROUND 11 OF 15');
  await playback.command('stage-1', 'ticker', 'preview');
  assert.equal(round(playback, 'preview'), 'STAGE TWO SOURCE');
  await publish('OLD BINDING STILL LIVE');
  assert.equal(round(playback), 'OLD BINDING STILL LIVE');
  assert.equal(round(playback, 'preview'), 'STAGE TWO SOURCE');
  await playback.command('stage-1', 'ticker', 'update');
  assert.equal(round(playback), 'STAGE TWO SOURCE');
});

test('missing/invalid source retains last good values, refuses writes and recovers without replaying graphics', async t => {
  const { playback, sources, publish } = await linkedFixture(t);
  await playback.command('stage-1', 'ticker', 'play', undefined, options('linked'));
  await publish('LAST VALID ROUND');
  const saved = await fs.readFile(sources.file, 'utf8');
  await fs.writeFile(sources.file, '{half-written');
  await sources.refresh(); await playback.refreshLinks('stage-1');
  assert.equal(sources.snapshot().health, 'unavailable');
  assert.equal(round(playback), 'LAST VALID ROUND');
  await assert.rejects(sources.updateSource('test.stage-1.currentRound', 'NEW', sources.snapshot().revision), { status: 503 });
  await fs.unlink(sources.file); await sources.refresh();
  assert.equal(sources.snapshot().health, 'unavailable');
  await fs.writeFile(sources.file, saved); await sources.refresh();
  assert.equal(sources.snapshot().health, 'ok');
  await publish('RECOVERED ROUND'); assert.equal(round(playback), 'RECOVERED ROUND');
  const external = JSON.parse(await fs.readFile(sources.file, 'utf8'));
  external.sources['test.stage-1.currentRound'].value = 'EXTERNAL EDIT';
  await fs.writeFile(sources.file, JSON.stringify(external)); await sources.refresh();
  assert.equal(sources.snapshot().health, 'unavailable');
  assert.equal(sources.value('test.stage-1.currentRound'), 'RECOVERED ROUND');
  external.revision++;
  await fs.writeFile(sources.file, JSON.stringify(external)); await sources.refresh(); await playback.refreshLinks('stage-1');
  assert.equal(sources.snapshot().health, 'ok');
  assert.equal(round(playback), 'EXTERNAL EDIT');
});

test('stale controller saves and stale data-manager writes cannot overwrite newer changes', async t => {
  const { playback, sources } = await linkedFixture(t);
  const editor = await playback.editor('stage-1', 'ticker');
  await playback.command('stage-1', 'ticker', 'save', [{ field: 'f5', value: 'NEW MANUAL' }], { revision: editor.revision });
  await assert.rejects(playback.command('stage-1', 'ticker', 'update', undefined, { ...options('linked'), revision: editor.revision }), { status: 409 });
  assert.equal((await playback.editor('stage-1', 'ticker')).fields.find(field => field.field === 'f5').value, 'NEW MANUAL');
  const old = sources.snapshot().revision;
  await sources.updateSource('test.stage-1.currentRound', 'NEW SOURCE', old);
  await assert.rejects(sources.updateSource('test.stage-1.currentRound', 'STALE SOURCE', old), { status: 409 });
  for (const value of ['', ' '.repeat(3), 'x'.repeat(301), 42]) await assert.rejects(sources.updateSource('test.stage-1.currentRound', value, sources.snapshot().revision), { status: 400 });
  assert.equal(sources.value('test.stage-1.currentRound'), 'NEW SOURCE');
  await assert.rejects(playback.command('stage-1', 'ticker', 'preview', undefined, { links: { f0: { mode: 'linked', manual: 'x' } } }), { status: 400 });
});

test('saved link mode and manual text survive restart, while program starts stopped', async t => {
  const { playback, repository, sources } = await linkedFixture(t);
  await playback.command('stage-1', 'ticker', 'play', undefined, options('linked', 'MY MANUAL ROUND'));
  const restarted = new Playback(repository, playback.slots, sources);
  assert.equal(restarted.snapshot('stage-1', 'program').graphics.length, 0);
  assert.equal((await restarted.editor('stage-1', 'ticker')).links.f5.manual, 'MY MANUAL ROUND');
  assert.equal((await restarted.editor('stage-1', 'ticker')).links.f5.mode, 'linked');
  await restarted.command('stage-1', 'ticker', 'play');
  assert.equal(round(restarted), 'SWISS ROUND 11 OF 15');
});

test('an unavailable source at startup does not block manual playback', async t => {
  const { playback, root, stages } = await fixture(t);
  const unavailable = new DataSources(root, stages); // A directory cannot be read as a source file.
  await unavailable.ready; playback.sources = unavailable;
  assert.equal(unavailable.snapshot().health, 'unavailable');
  await playback.command('stage-1', 'ticker', 'play');
  assert.equal(round(playback), 'STAGE 1 ROUND');
  await assert.rejects(playback.command('stage-1', 'ticker', 'preview', undefined, options('linked')), { status: 422 });
});

test('renderer health distinguishes current revision, errors, output mode and expired connections', () => {
  let now = 1000; const registry = new Renderers(() => now);
  assert.equal(registry.snapshot('stage-1', 2).program.connected, 0);
  registry.report('stage-1', 'preview', { id: 'preview', revision: 2, state: 'ready' });
  registry.report('stage-1', 'program', { id: 'program', revision: 1, state: 'ready' });
  assert.equal(registry.snapshot('stage-1', 2).preview.ready, 1);
  assert.equal(registry.snapshot('stage-1', 2).program.ready, 0);
  registry.report('stage-1', 'program', { id: 'program', revision: 2, state: 'error', message: 'Template failed' });
  assert.deepEqual(registry.snapshot('stage-1', 2).program.errors, ['Template failed']);
  assert.equal(registry.snapshot('stage-2', 2).program.connected, 0);
  now += 15001; assert.equal(registry.snapshot('stage-1', 2).program.connected, 0);
  assert.throws(() => registry.report('stage-1', 'program', { id: '../bad', revision: 0, state: 'ready' }));
});
