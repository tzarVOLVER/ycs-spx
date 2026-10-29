'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const register = require('../index.cjs');
const { fixture } = require('./playback.test.cjs');
const { build, generate, loadStages, pageExport } = require('../companion/generate.cjs');
const contract = require('../public/companion-contract.js');
const slots = { ticker: { order: 10 }, 'lower-third': { order: 20 } };
async function setup(t, apiKey) {
  const f = await fixture(t);
  const saved = await f.repository.read('stage-1');
  saved.templates[0].itemID = '1799991234';
  saved.templates[0].ycsNickname = 'Orlando ticker';
  saved.templates[1].itemID = 'guest-intro';
  await f.repository.write('stage-1', saved);
  const config = {
    general: { dataroot: f.root, username: '', port: 5660 },
    ycs: {
      enabled: true,
      dataFile: path.join(f.root, 'sources.json'),
      stages: f.stages,
      slots,
      ...(apiKey ? { apiKey } : {})
    }
  };
  const app = express();
  app.use(express.json());
  const playback = register(app, config, { auth: { CheckLogin: (req, res, next) => next() } });
  await playback.sources.ready;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(async () => {
    playback.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const readStages = () => loadStages(f.repository, slots);
  return { ...f, config, playback, base, readStages };
}
function action(button) {
  return button.steps[0].action_sets.down[0];
}
function urls(profile) {
  return Object.values(profile.pages).flatMap((page) =>
    Object.values(page.controls).flatMap((row) =>
      Object.values(row).flatMap((button) =>
        button.steps[0].action_sets.down.map((a) => a.options.url.value)
      )
    )
  );
}
test('exports use actual IDs and all saved graphic copies; generated buttons execute stage-scoped saved data', async (t) => {
  const r = await setup(t),
    stages = await r.readStages(),
    profile = build(r.base, stages);
  assert.equal(profile.version, 12);
  assert.equal(profile.instances['ycs-spx-http'].moduleId, 'generic-http');
  assert.equal(profile.pages[1].controls[1][0].style.layers[2].text.value, 'Orlando ticker');
  assert.ok(urls(profile).some((url) => url.includes('/1799991234/play')));
  assert.ok(urls(profile).some((url) => url.includes('/guest-intro/play')));
  assert.ok(!urls(profile).some((url) => url.includes('/stage-1/graphics/ticker/')));
  assert.equal(profile.triggers, undefined);
  assert.equal(profile.surfaces, undefined);
  const press = async (button) => {
    const a = action(button);
    assert.deepEqual(button.steps[0].action_sets.up, []);
    const result = await fetch(r.base + a.options.url.value, {
      method: 'POST',
      headers: { 'Content-Type': a.options.contenttype.value },
      body: a.options.body.value
    });
    assert.equal(result.status, 200);
    return result.json();
  };
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index],
      page = profile.pages[index + 1];
    for (let n = 0; n < stage.graphics.length; n++) {
      const row = page.controls[n + 1],
        item = stage.graphics[n];
      await press(row[1]);
      await press(row[1]);
      assert.ok(r.playback.snapshot(stage.id, 'program').graphics.some((g) => g.id === item.id));
      await press(row[2]);
      await press(row[3]);
      await press(row[3]);
      await press(row[2]);
      assert.ok(!r.playback.snapshot(stage.id, 'program').graphics.some((g) => g.id === item.id));
    }
    await press(page.controls[1][1]);
    await press(page.controls[2][1]);
    assert.equal(r.playback.snapshot(stage.id, 'program').graphics.length, 2);
    await press(page.controls[0][7]);
    assert.equal(r.playback.snapshot(stage.id, 'program').graphics.length, 0);
  }
  const toggles = build(r.base, stages, 'ycs_spx', { toggles: true });
  const ticker = toggles.pages[1].controls[1];
  assert.match(action(ticker[1]).options.url.value, /1799991234\/toggle$/);
  await press(ticker[1]);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 1);
  await r.playback.command('stage-1', '1799991234', 'stop');
  await press(ticker[1]);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 1);
  await press(ticker[4]);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  assert.equal(r.playback.snapshot('stage-2', 'program').graphics.length, 0);
});
test('pagination and fourth outputs retain every ID; exports reject ambiguous IDs and invalid origins', () => {
  const stages = Array.from({ length: 4 }, (_, n) => ({
    id: 'stage-' + (n + 1),
    title: 'Stage ' + (n + 1),
    graphics: Array.from({ length: 7 }, (_, i) => ({
      id: 'copy-' + i,
      title: 'Graphic ' + i,
      slot: 'ticker'
    }))
  }));
  const profile = build('http://SPX-PC:5660', stages);
  for (const stage of stages)
    for (const item of stage.graphics)
      assert.ok(urls(profile).includes(contract.command(stage.id, item.id, 'play').path));
  const page = pageExport(profile, 1);
  assert.equal(page.type, 'page');
  assert.equal(page.page, profile.pages[1]);
  assert.throws(() => pageExport(profile, 999));
  assert.throws(() => build('http://example.com', [{ id: 'stage-1' }]), /rundown/);
  for (const base of ['https://user:secret@example.com', 'file:///a', 'http://example.com/path'])
    assert.throws(() => build(base, stages));
  assert.throws(() =>
    build('http://example.com', [{ id: 'stage-1', graphics: [{ id: '../bad', slot: 'ticker' }] }])
  );
});
test('authenticated download routes include no field/source secrets, stay off air, and validate slots and page selection', async (t) => {
  const r = await setup(t, 'PRIVATE-TEST-TOKEN');
  const before = await fs.readFile(r.repository.stage('stage-1').file, 'utf8');
  const get = (url, headers = {}) => fetch(r.base + '/api/ycs' + url, { headers });
  assert.equal((await get('/companion/export')).status, 401);
  const headers = { Authorization: 'Bearer PRIVATE-TEST-TOKEN' };
  assert.equal(
    (await get('/companion/export', { ...headers, Origin: 'https://untrusted.example' })).status,
    403
  );
  const response = await get('/stages/stage-1/companion?style=toggle', headers);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const text = await response.text(),
    profile = JSON.parse(text);
  assert.ok(urls(profile).every((url) => url.startsWith('/api/ycs/stages/stage-1/')));
  assert.equal(Object.keys(profile.pages).length, 1);
  assert.equal(profile.instances['ycs-spx-http'].config.prefix, r.base);
  assert.ok(!text.includes('PRIVATE-TEST-TOKEN'));
  assert.ok(!text.includes('STAGE 1 ROUND'));
  const page = await (await get('/companion/export?page=1', headers)).json();
  assert.equal(page.type, 'page');
  assert.equal((await get('/companion/export?style=wrong', headers)).status, 422);
  assert.equal((await get('/companion/export?page=999', headers)).status, 422);
  assert.equal(await fs.readFile(r.repository.stage('stage-1').file, 'utf8'), before);
  assert.equal(r.playback.snapshot('stage-1', 'program').graphics.length, 0);
  const saved = await r.repository.read('stage-1');
  delete saved.templates[0].ycsSlot;
  await r.repository.write('stage-1', saved);
  const invalid = await get('/stages/stage-1/companion', headers);
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).error, /output slot/);
});
test('CLI exports read the configured rundown and use the selected server origin without generating guessed rehearsal targets', async (t) => {
  const r = await setup(t);
  const files = await generate(r.root, r.config, { baseUrl: 'http://SPX-PC:5660' });
  assert.ok(files.length > 2);
  assert.ok(files.every((file) => !file.includes('Rehearsal')));
  const profile = JSON.parse(
    await fs.readFile(path.join(r.root, 'dist/companion/YCS-Orlando.companionconfig'), 'utf8')
  );
  assert.ok(urls(profile).includes('/api/ycs/stages/stage-1/graphics/1799991234/play'));
  assert.equal(profile.instances['ycs-spx-http'].config.prefix, 'http://spx-pc:5660');
});
