'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const register = require('../index.cjs');
const { fixture } = require('./playback.test.cjs');
const { build } = require('../companion/generate.cjs');

test('generated Companion controls execute saved stage-specific graphics without a controller and never toggle', async t => {
  const { root, stages } = await fixture(t), app = express(); app.use(express.json());
  const config = { general: { dataroot: root, username: '' }, ycs: { enabled: true, dataFile: path.join(root, 'sources.json'), stages, slots: { ticker: { order: 10 }, 'lower-third': { order: 20 } } } };
  const playback = register(app, config, { auth: { CheckLogin: (req, res, next) => next() } });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => { playback.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`, profile = build(base, stages);
  assert.equal(profile.version, 12); assert.equal(profile.instances['ycs-spx-http'].moduleId, 'generic-http');
  assert.equal(Object.keys(profile.pages).length, 4);
  assert.equal(profile.triggers, undefined); assert.equal(profile.surfaces, undefined);
  for (const [index, stage] of stages.entries()) {
    const row = profile.pages[index + 1].controls[0];
    async function press(column) {
      const action = row[column].steps[0].action_sets.down[0];
      const response = await fetch(base + action.options.url.value, { method: 'POST', headers: { 'Content-Type': action.options.contenttype.value }, body: action.options.body.value });
      assert.equal(response.status, 200); return response.json();
    }
    await press(1); await press(1); // Repeated explicit Play stays playing.
    await press(4); assert.equal(playback.snapshot(stage.id, 'program').graphics.length, 2);
    await press(2); await press(5);
    assert.equal(playback.snapshot(stage.id, 'program').graphics[0].data.f5, `STAGE ${index + 1} ROUND`);
    await press(3); await press(3); assert.deepEqual(playback.snapshot(stage.id, 'program').graphics.map(item => item.id), ['lower-third']);
    await press(6); await press(2); assert.equal(playback.snapshot(stage.id, 'program').graphics.length, 0, 'Update must not start a stopped graphic');
    await press(1); await press(7); assert.equal(playback.snapshot(stage.id, 'program').graphics.length, 0);
    for (const button of Object.values(row)) for (const action of button.steps[0].action_sets.down) assert.ok(action.options.url.value.startsWith(`/api/ycs/stages/${stage.id}/`));
  }
  const fourth = build(base, [...stages, { id: 'stage-4', title: 'Stage 4' }]);
  assert.equal(fourth.pages[4].controls[0][1].steps[0].action_sets.down[0].options.url.value, '/api/ycs/stages/stage-4/graphics/ticker/play');
  for (const invalid of ['https://user:secret@example.com', 'file:///tmp/a', base + '/path']) assert.throws(() => build(invalid, stages));
});
