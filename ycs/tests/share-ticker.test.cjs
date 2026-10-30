'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('./playback.test.cjs');
const { migrate, SHARED } = require('../share-ticker.cjs');

test('shared template migration preserves values, identities, links and mappings, with idempotent exact backups', async t => {
  const { root, stages, repository } = await fixture(t), graphics = path.join(root, 'graphics');
  await fs.mkdir(graphics); await fs.writeFile(path.join(graphics, 'ticker.html'), '<html></html>');
  const originals = new Map();
  for (const [index, stage] of stages.entries()) {
    const document = await repository.read(stage.id), item = document.templates[0];
    item.relpath = `/ycs/ticker/YCS-Ticker-${index + 1}.html`;
    item.ycsLinks = { f5: { mode: 'linked', manual: 'CUSTOM MANUAL' } };
    await repository.write(stage.id, document);
    await fs.writeFile(path.join(root, stage.project, 'profile.json'), JSON.stringify(document));
    originals.set(stage.id, await fs.readFile(repository.stage(stage.id).file, 'utf8'));
  }
  const sourceFile = path.join(root, 'sources.json');
  const data = { version: 2, revision: 8, sources: { saved: { value: 'KEEP' } }, connections: {}, mappings: [{ stage: 'stage-1', graphic: 'ticker', field: 'f5', source: 'saved' }], defaults: stages.map((stage, index) => ({ stage: stage.id, template: `/ycs/ticker/YCS-Ticker-${index + 1}.html`, field: 'f5', binding: { source: 'saved' } })) };
  const raw = JSON.stringify(data); await fs.writeFile(sourceFile, raw);
  const config = { general: { dataroot: root }, ycs: { graphicsRoot: graphics, stages, dataFile: sourceFile } };
  assert.equal((await migrate(root, config)).length, 7);
  for (const stage of stages) {
    const saved = await repository.read(stage.id), original = JSON.parse(originals.get(stage.id));
    assert.equal(saved.templates[0].relpath, SHARED);
    assert.deepEqual(saved.templates[0].DataFields, original.templates[0].DataFields);
    assert.deepEqual(saved.templates[0].ycsLinks, original.templates[0].ycsLinks);
    assert.equal(saved.templates[0].itemID, 'ticker');
    assert.deepEqual(saved.templates[1], original.templates[1]);
    assert.equal(await fs.readFile(repository.stage(stage.id).file + '.before-shared-ticker.json', 'utf8'), originals.get(stage.id));
  }
  const updated = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  assert.deepEqual(updated.connections, data.connections); assert.deepEqual(updated.sources, data.sources); assert.deepEqual(updated.mappings, data.mappings);
  assert.equal(updated.revision, 9); assert.ok(updated.defaults.every(entry => entry.template === SHARED));
  assert.equal(await fs.readFile(sourceFile + '.before-shared-ticker.json', 'utf8'), raw);
  assert.equal((await migrate(root, config)).length, 0);
  // Conflicts must be rejected during planning, before any file is changed.
  updated.defaults.push({ ...updated.defaults[0], binding: { static: 'CONFLICT' } });
  await fs.writeFile(sourceFile, JSON.stringify(updated));
  const before = await fs.readFile(repository.stage('stage-1').file, 'utf8');
  await assert.rejects(migrate(root, config), /Conflicting template defaults/);
  assert.equal(await fs.readFile(repository.stage('stage-1').file, 'utf8'), before);
});
