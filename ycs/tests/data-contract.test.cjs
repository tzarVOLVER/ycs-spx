'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const contract = require('../data-contract.cjs');
const fixtures = require('../contracts/fixtures.json');
const { normalizeField } = require('../field-types.cjs');
const { selection, resolve } = require('../bindings.cjs');
const { normalizeSelection, resolveCollection, normalizeValue } = require('../collections.cjs');
const read = (file) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function check(fn, item, key = 'value', error = 'error') {
  if (item[error]) assert.throws(fn);
  else assert.deepEqual(fn(), item[key]);
}

test('vendored contracts and fixtures match the published manifest', () => {
  const manifest = require('../contracts/manifest.json');
  assert.equal(hash(read('contracts/fixtures.json')), manifest.fixturesSha256);
  for (const [file, expected] of Object.entries(manifest.files))
    assert.equal(hash(read(file.slice(4))), expected, file);
});

test('Node and browser contracts obey the same fixtures', () => {
  const context = vm.createContext({});
  vm.runInContext(read('public/data-contract.js'), context);
  const browser = context.YCSDataContract;
  for (const api of [contract, browser]) {
    for (const item of fixtures.booleans)
      for (const policy of ['checkbox', 'published', 'spx'])
        check(() => api.booleanValue(item.input, policy), item, policy, policy + 'Error');
    for (const item of fixtures.numbers) check(() => api.finiteNumber(item.input), item);
    for (const item of fixtures.pointers) {
      // Arrays/objects cross VM realms; compare the wire representation.
      check(() => JSON.parse(JSON.stringify(api.jsonPointerTokens(item.pointer))), item, 'tokens');
      if (item.error) continue;
      assert.equal(item.tokens.reduce(api.appendJsonPointer, ''), item.pointer);
      assert.deepEqual(
        api.readJsonPointer(item.data, item.pointer),
        item.missing ? undefined : item.value
      );
    }
    for (const item of fixtures.spxFields)
      check(() => JSON.parse(JSON.stringify(api.readSpxFields(item.input))), item);
  }
});

test('native fields and collection publication preserve their distinct conversion policies', () => {
  const collection = (input) => ({
    kind: 'collection',
    format: 'json',
    pointer: '',
    fields: { subtopic: { kind: 'property', pointer: '/message' } },
    required: ['subtopic'],
    enabled: { kind: 'property', pointer: '/published' }
  });
  for (const item of fixtures.booleans) {
    const fn = () => normalizeField({ ftype: 'checkbox' }, item.input);
    if (item.checkboxError) assert.throws(fn);
    else assert.equal(fn(), item.checkbox ? '1' : '0');
    const pick = normalizeSelection(collection(), {});
    const result = resolveCollection([{ published: item.input, message: 'Story' }], pick);
    if (item.publishedError) assert.equal(result.invalid, 1);
    else {
      assert.equal(result.invalid, 0);
      assert.equal(result.included, item.published ? 1 : 0);
    }
  }
  for (const item of fixtures.numbers) {
    if (item.error) assert.throws(() => normalizeField({ ftype: 'number' }, item.input));
    else assert.equal(normalizeField({ ftype: 'number' }, item.input), String(item.value));
  }
});

test('scalar bindings use the same escaped, own-property-only JSON paths', () => {
  for (const item of fixtures.pointers) {
    if (item.error) {
      assert.throws(() => selection({ kind: 'json', pointer: item.pointer }, {}));
      continue;
    }
    const pick = selection({ kind: 'json', pointer: item.pointer }, {});
    if (item.missing || typeof item.value === 'object')
      assert.throws(() => resolve(item.data, pick));
    else assert.equal(resolve(item.data, pick), String(item.value));
  }
});

test('shared story fixtures preserve server optional fields before ticker defaults', () => {
  const field = {
    ycsCollection: {
      version: 1,
      fields: [
        { key: 'category', title: 'Category' },
        { key: 'topic', title: 'Topic' },
        { key: 'subtopic', title: 'Crawler text', required: true }
      ]
    }
  };
  for (const item of fixtures.stories)
    check(() => JSON.parse(normalizeValue(field, JSON.stringify(item.items))), item, 'server');
});
