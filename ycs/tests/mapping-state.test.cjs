'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function modules() {
  const context = vm.createContext({ structuredClone });
  context.window = context;
  for (const file of [
    'data-contract.js',
    'mapping-data.js',
    'mapping-state.js',
    'mapping-api.js',
    'collection-state.js'
  ])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context);
  return context;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('draft and request snapshots cannot be changed by later edits or borrowed binding objects', async () => {
  const api = modules(),
    drafts = new api.YCSMappingDrafts(),
    model = drafts.load('stage / 1', 'ticker?2', {
      revision: 7,
      template: 'ticker.html',
      fields: []
    });
  const binding = { connection: 'sheet', selection: { kind: 'cell', cell: 'B2' } };
  drafts.edit(model, 'f5', binding, 'item');
  binding.selection.cell = 'C3';
  assert.equal(model.edits.get('f5').binding.selection.cell, 'B2');
  const body = drafts.saveBody(model),
    requests = [],
    transport = new api.YCSMappingAPI((url, body) => {
      requests.push({ url, body });
      return Promise.resolve({});
    });
  await transport.save(model.stage, model.graphic, body);
  body.edits[0].binding.selection.cell = 'Z9';
  model.edits.get('f5').binding.selection.cell = 'D4';
  assert.equal(requests[0].url, '/data/mappings/stage%20%2F%201/ticker%3F2');
  assert.equal(requests[0].body.edits[0].binding.selection.cell, 'B2');
  await transport.previewCollection({
    stage: model.stage,
    graphic: model.graphic,
    model,
    field: 'f14',
    binding: { selection: { kind: 'collection' } },
    scope: 'item'
  });
  model.edits.clear();
  assert.equal(requests[1].body.edits.length, 2);
  assert.equal(requests[1].body.edits[0].field, 'f5');
});

test('selection tokens and accepted revisions preserve cached drafts without accepting stale loads', () => {
  const api = modules(),
    drafts = new api.YCSMappingDrafts(),
    a = drafts.load('s1', 'a', { revision: 4 }),
    b = drafts.load('s1', 'b', { revision: 3 });
  drafts.current = a;
  const before = drafts.beginSelection();
  assert.equal(drafts.current, null);
  const after = drafts.beginSelection();
  assert.equal(drafts.isLatest(before), false);
  assert.equal(drafts.isLatest(after), true);
  drafts.acceptRevision(4, 5);
  assert.equal(a.revision, 5);
  assert.equal(b.revision, 3);
  drafts.dispose();
  assert.equal(drafts.isLatest(after), false);
});

test('collection draft keeps transforms and fallbacks when browsing another header or JSON array', () => {
  const api = modules(),
    schema = { fields: [{ key: 'subtopic', title: 'Crawler text', required: true }] };
  const connection = {
    type: 'google-sheets',
    settings: { range: 'A10:B14' },
    rows: [
      [
        { address: 'A10', value: 'Subtopic' },
        { address: 'B10', value: 'Other' }
      ],
      [
        { address: 'A12', value: 'Next' },
        { address: 'B12', value: 'Subtopic' }
      ]
    ]
  };
  const draft = new api.YCSCollectionDraft(schema, 'sheet', connection, null);
  assert.equal(draft.pick.headerRow, 10);
  const field = draft.controls[0];
  draft.setField(field, {
    source: 'ref:Subtopic',
    text: 'Fallback',
    transform: 'uppercase',
    prefix: ''
  });
  const snapshot = draft.binding();
  draft.header(12, connection);
  assert.deepEqual(plain(draft.selected(field)), {
    kind: 'column',
    name: 'Subtopic',
    fallback: 'Fallback',
    transform: { kind: 'uppercase' }
  });
  draft.range('B12:B14');
  assert.equal(snapshot.selection.range, 'A10:B14');
  assert.equal(snapshot.selection.headerRow, 10);
  const json = {
    type: 'json-api',
    data: { 'a/b': { '~items': [{ message: 'First' }] }, other: [{ message: 'Second' }] }
  };
  const records = new api.YCSCollectionDraft(schema, 'api', json, null);
  assert.equal(records.pick.pointer, '/a~1b/~0items');
  records.setField(records.controls[0], {
    source: 'ref:/message',
    text: 'Fallback',
    transform: 'trim',
    prefix: ''
  });
  records.array('/other', json);
  assert.equal(records.pick.fields.subtopic.pointer, '/message');
  assert.equal(records.pick.fields.subtopic.transform.kind, 'trim');
  assert.equal(records.pick.fields.subtopic.fallback, 'Fallback');
});

test('worksheet metadata requests are shared while callers retain independent drafts', async () => {
  const api = modules();
  let calls = 0,
    complete;
  const transport = new api.YCSMappingAPI(() => {
    calls++;
    return new Promise((resolve) => (complete = resolve));
  });
  const a = transport.worksheetNames('sheet'),
    b = transport.worksheetNames('sheet');
  assert.equal(a, b);
  assert.equal(calls, 1);
  complete({ worksheets: [{ id: '7', name: 'Stage 1' }] });
  assert.deepEqual(plain(await a), { 7: 'Stage 1' });
});
