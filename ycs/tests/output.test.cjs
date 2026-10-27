'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { randomUUID } = require('node:crypto');
async function eventually(condition) {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('Renderer did not reach the expected state');
}
async function renderer(t) {
  const dom = new JSDOM('<main id="composition"></main>', { url: 'http://localhost/output/stage-1/program', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [], reports = [];
  let events, failed = false;
  window.console.error = () => {};
  window.crypto.randomUUID = randomUUID;
  window.fetch = async (url, request) => { reports.push(JSON.parse(request.body)); return { ok: true }; };
  window.io = () => {
    events = { on: (event, callback) => { events[event] = callback; }, emit() {}, disconnect() {} };
    return events;
  };
  const root = window.document.getElementById('composition');
  const append = root.append.bind(root);
  root.append = frame => {
    append(frame);
    for (const name of ['update', 'play', 'stop']) frame.contentWindow[name] = data => {
      calls.push({ id: frame.dataset.graphic, name, data });
      if (failed && name === 'play' && frame.dataset.graphic === 'replacement') throw new Error('Template failed to load');
    };
    queueMicrotask(() => frame.onload());
  };
  window.eval(await fs.readFile(path.join(__dirname, '../public/output.js'), 'utf8'));
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  const send = (revision, graphics) => events.state({ stage: 'stage-1', mode: 'program', revision, graphics });
  const graphic = (id, slot = id, text = 'ROUND 11') => ({ id, slot, z: 10, exitMs: 1, template: '/templates/test.html', data: { f5: text } });
  return { window, root, calls, reports, events: () => events, send, graphic, fail: () => { failed = true; }, recover: () => { failed = false; } };
}

test('live field updates retain the ticker iframe and do not replay Play or touch another slot', async t => {
  const r = await renderer(t);
  r.send(1, [r.graphic('ticker'), r.graphic('lower-third')]);
  await eventually(() => r.root.dataset.revision === '1');
  const ticker = r.root.querySelector('[data-graphic="ticker"]');
  const lower = r.root.querySelector('[data-graphic="lower-third"]');
  const before = r.calls.length;
  r.send(2, [r.graphic('ticker', 'ticker', 'ROUND 12'), r.graphic('lower-third')]);
  await eventually(() => r.root.dataset.revision === '2');
  assert.equal(r.root.querySelector('[data-graphic="ticker"]'), ticker);
  assert.equal(r.root.querySelector('[data-graphic="lower-third"]'), lower);
  assert.deepEqual(r.calls.slice(before).map(call => [call.id, call.name]), [['ticker', 'update']]);
  assert.equal(r.reports.at(-1).revision, 2);
  assert.equal(r.reports.at(-1).state, 'ready');
  r.send(3, [r.graphic('ticker', 'ticker', 'ROUND 12'), r.graphic('lower-third')]);
  await eventually(() => r.root.dataset.revision === '3');
  assert.equal(r.calls.length, before + 1);
});

test('failed replacements retain the old graphic, report errors and accept a recovered snapshot', async t => {
  const r = await renderer(t);
  r.send(1, [r.graphic('ticker')]); await eventually(() => r.root.dataset.revision === '1');
  const original = r.root.querySelector('[data-graphic="ticker"]');
  r.fail(); r.send(2, [r.graphic('replacement', 'ticker')]);
  await eventually(() => r.reports.at(-1)?.state === 'error');
  assert.equal(r.root.querySelector('[data-graphic="ticker"]'), original);
  assert.equal(r.root.querySelector('[data-graphic="replacement"]'), null);
  assert.match(r.reports.at(-1).message, /Template failed/);
  r.recover(); r.send(2, [r.graphic('replacement', 'ticker')]);
  await eventually(() => r.root.dataset.revision === '2');
  assert.equal(r.root.querySelector('[data-graphic="ticker"]'), null);
  assert.equal(r.root.querySelectorAll('iframe').length, 1);
  assert.equal(r.reports.at(-1).state, 'ready');
  r.events()['connect_error']();
  await eventually(() => r.reports.at(-1)?.state === 'error');
  assert.match(r.reports.at(-1).message, /connection lost/i);
});

test('navigating an output closes health cleanly even when the browser transport has already closed', async t => {
  const r = await renderer(t);
  r.send(1, [r.graphic('ticker')]); await eventually(() => r.root.dataset.revision === '1');
  r.events().disconnect = () => { throw new Error('Transport not open'); };
  r.window.dispatchEvent(new r.window.Event('pagehide'));
  assert.equal(r.reports.at(-1).state, 'closed');
  assert.equal(r.root.querySelectorAll('iframe').length, 0);
  r.events()['connect_error']();
  assert.equal(r.reports.at(-1).state, 'closed', 'a disposed output must not re-register as an error renderer');
});
