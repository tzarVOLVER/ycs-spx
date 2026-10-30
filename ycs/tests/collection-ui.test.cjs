'use strict';
const { loadDataManagerScripts } = require('./helpers/browser.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { normalizeSelection, resolveCollection } = require('../collections.cjs');
test('playlist editor maps current sheet headers, shows publication status, keeps Cancel off the draft and supports JSON arrays', async (t) => {
  const dom = new JSDOM(
      await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'),
      { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only' }
    ),
    window = dom.window;
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  t.after(() => window.close());

  await loadDataManagerScripts(window);
  const $ = (id) => window.document.getElementById(id),
    field = {
      field: 'f14',
      title: 'Stories',
      ycsCollection: {
        version: 1,
        fields: [
          { key: 'category', title: 'Category' },
          { key: 'topic', title: 'Topic' },
          { key: 'subtopic', title: 'Crawler text', aliases: ['Subtopic'], required: true }
        ]
      }
    };
  const cells = [
    ['Published', 'Category', 'Topic', 'Subtopic'],
    ['TRUE', 'TCG', 'News', 'Literal <b>message</b>'],
    ['FALSE', 'TCG', 'Hidden', 'Not published']
  ].map((row, i) =>
    row.map((value, j) => ({ address: String.fromCharCode(65 + j) + (i + 1), value }))
  );
  const state = {
    connections: {
      sheet: { label: 'Ticker', type: 'google-sheets', settings: { range: 'A1:D3' }, rows: cells },
      api: {
        label: 'API',
        type: 'json-api',
        data: {
          event: {
            stories: [
              { published: true, section: 'Games', headline: 'Final', message: 'JSON story' }
            ]
          }
        }
      }
    }
  };
  let assigned;
  const model = { edits: new Map() },
    workspace = {
      $,
      model,
      stage: 'stage-1',
      sourceId: 'sheet',
      getState: () => state,
      project: () => undefined,
      binding: () => null,
      node: (tag, text) => {
        const element = window.document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      },
      fieldLabel: (title, input) => {
        const label = window.document.createElement('label');
        label.textContent = title;
        label.append(input);
        return label;
      },
      control: (options, value, label) => {
        const select = window.document.createElement('select');
        for (const [key, text] of options) {
          const option = window.document.createElement('option');
          option.value = key;
          option.textContent = text;
          select.append(option);
        }
        select.value = value;
        select.setAttribute('aria-label', label);
        return select;
      },
      assign: (binding) => (assigned = binding),
      request: async (url, { edits }) => {
        const binding = edits.at(-1).binding,
          connection = state.connections[binding.connection],
          pick = normalizeSelection(binding.selection, connection.settings),
          report = resolveCollection(
            connection.type === 'json-api' ? connection.data : connection.rows,
            pick
          );
        return { fields: [{ field: 'f14', collection: report, error: report.error }] };
      }
    };
  const editor = new window.YCSCollectionEditor(workspace);
  await editor.open(field);
  assert.equal($('use-playlist').disabled, false);
  assert.match($('playlist-status').textContent, /1 stories included.*1 unpublished/);
  assert.equal(editor.pick.fields.subtopic.name, 'Subtopic');
  assert.equal(editor.pick.enabled.name, 'Published');
  assert.equal(
    window.document.querySelector('#playlist-result b'),
    null,
    'source text never becomes HTML'
  );
  const crawlerTransform = window.document.querySelector('[aria-label="Crawler text transform"]');
  crawlerTransform.value = 'uppercase';
  crawlerTransform.dispatchEvent(new window.Event('change'));
  await editor.preview();
  assert.equal(editor.report.rows[0].values.subtopic, 'LITERAL <B>MESSAGE</B>');
  assert.equal(cells[1][3].value, 'Literal <b>message</b>');
  assert.equal(window.document.querySelector('[aria-label="Published / enabled transform"]'), null);
  editor.close();
  assert.equal(assigned, undefined);
  await editor.open(field);
  const categoryTransform = window.document.querySelector('[aria-label="Category transform"]');
  categoryTransform.value = 'lowercase';
  categoryTransform.dispatchEvent(new window.Event('change'));
  await editor.preview();
  editor.apply();
  assert.equal(assigned.selection.format, 'sheet');
  assert.equal(assigned.selection.fields.subtopic.name, 'Subtopic');
  assert.equal(assigned.selection.fields.category.transform.kind, 'lowercase');
  workspace.binding = () => assigned;
  await editor.open(field);
  assert.equal(
    window.document.querySelector('[aria-label="Category transform"]').value,
    'lowercase'
  );
  editor.close();
  workspace.binding = () => null;
  workspace.sourceId = 'api';
  await editor.open(field);
  assert.equal(editor.pick.pointer, '/event/stories');
  const crawler = window.document.querySelector('[aria-label="Crawler text mapping"]');
  crawler.value = 'ref:/message';
  crawler.dispatchEvent(new window.Event('change'));
  await editor.preview();
  editor.apply();
  assert.equal(assigned.selection.format, 'json');
  assert.equal(assigned.selection.fields.subtopic.pointer, '/message');
  clearTimeout(editor.timer);
});

test('closed and disposed story dialogs ignore late requests without changing the graphic draft', async (t) => {
  const dom = new JSDOM(
      await fs.readFile(path.join(__dirname, '../public/data-manager.html'), 'utf8'),
      { url: 'http://localhost/ycs/data-manager', runScripts: 'outside-only' }
    ),
    window = dom.window;
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  t.after(() => window.close());
  await loadDataManagerScripts(window);
  const $ = (id) => window.document.getElementById(id),
    pending = [],
    model = { stage: 'stage-1', graphic: 'ticker', edits: new Map() },
    field = {
      field: 'f14',
      title: 'Stories',
      ycsCollection: {
        version: 1,
        fields: [{ key: 'subtopic', title: 'Crawler text', required: true }]
      }
    },
    state = {
      connections: {
        api: { type: 'json-api', label: 'API', data: { stories: [{ subtopic: 'First' }] } }
      }
    };
  let assignments = 0;
  const workspace = {
      $,
      model,
      stage: 'stage-1',
      sourceId: 'api',
      getState: () => state,
      project: () => undefined,
      binding: () => null,
      assign: () => assignments++,
      request: () => new Promise((resolve) => pending.push(resolve))
    },
    editor = new window.YCSCollectionEditor(workspace);
  const first = editor.open(field);
  editor.close();
  pending[0]({ fields: [{ field: 'f14', collection: { included: 99, excluded: 0, rows: [] } }] });
  await first;
  assert.equal(editor.validBinding, null);
  assert.equal($('playlist-result').children.length, 0);
  editor.apply();
  assert.equal(assignments, 0);
  const second = editor.open(field);
  editor.dispose();
  pending[1]({ fields: [{ field: 'f14', collection: { included: 99, excluded: 0, rows: [] } }] });
  await second;
  assert.equal(editor.validBinding, null);
  assert.equal($('playlist-result').children.length, 0);
  assert.equal($('use-playlist').onclick, null);
  assert.equal(model.edits.size, 0);
});
