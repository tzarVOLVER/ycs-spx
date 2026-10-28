'use strict';
// Companion 5.1 JSON export format, verified against a real 5.1.1 page export.
// No settings, surfaces, triggers, private source data or credentials included.
const fs = require('node:fs/promises');
const path = require('node:path');
const value = value => ({ value, isExpression: false });
const connectionId = 'ycs-spx-http';
const colors = { play: 0x17693c, toggle: 0x655097, update: 0x125a86, stop: 0x922c36, clear: 0x721e2a, label: 0x273944 };
const actions = [
  ['ticker', 'play', 'TICKER\nPLAY'], ['ticker', 'update', 'TICKER\nUPDATE'], ['ticker', 'stop', 'TICKER\nSTOP'],
  ['lower-third', 'play', 'LOWER THIRD\nPLAY'], ['lower-third', 'update', 'LOWER THIRD\nUPDATE'], ['lower-third', 'stop', 'LOWER THIRD\nSTOP'],
  [null, 'clear', 'STOP\nSTAGE']
];
function button(id, text, color, uri) {
  const geometry = { enabled: value(true), opacity: value(100), x: value(0), y: value(0), width: value(100), height: value(100), rotation: value(0) };
  return {
    type: 'button-layered',
    options: { stepProgression: 'auto', stepExpression: '', rotaryActions: false, canModifyStyleInApis: false, notes: uri ? `Explicit stage command: ${uri}. Empty body uses saved rundown fields; use the rundown for edits. Colors identify actions, not live program state.` : 'Stage label; no playout action.' },
    style: { layers: [
      { id: 'canvas', name: 'Canvas', usage: 'auto', type: 'canvas', decoration: value('default'), showStatusIcons: value('all') },
      { id: 'background', name: 'Background', type: 'box', usage: 'auto', pinnedProperties: ['color'], ...geometry, color: value(color), cornerRadius: value(5), borderWidth: value(0), borderColor: value(0), borderPosition: value('inside') },
      { id: 'label', name: 'Text', type: 'text', usage: 'auto', pinnedProperties: ['text', 'fontsize', 'color'], ...geometry, x: value(5), y: value(10), width: value(90), height: value(80), text: value(text), color: value(0xffffff), halign: value('center'), valign: value('center'), fontsize: value(22), fontsizeAllowShrink: value(true), font: value('companion-sans'), weight: value('bold'), styles: value([]), outlineColor: value(0xff000000) }
    ] },
    feedbacks: [], localVariables: [], steps: { '0': { options: { runWhileHeld: [] }, action_sets: { down: uri ? [{ id: `action-${id}`, type: 'action', definitionId: 'post', connectionId, upgradeIndex: 3, options: { url: value(uri), body: value('{}'), header: value(''), contenttype: value('application/json'), result_stringify: value(true), jsonResultDataVariable: { isExpression: false }, statusCodeVariable: { isExpression: false } } }] : [], up: [] } } }
  };
}
function normalize(baseUrl, stages) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use an HTTP(S) server origin without credentials, path, query or fragment');
  if (!Array.isArray(stages) || !stages.length || stages.length > 20 || stages.some(stage => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(stage.id)) || new Set(stages.map(stage => stage.id)).size !== stages.length) throw new Error('Choose distinct configured stage IDs');
  return url.origin;
}
function build(baseUrl, stages, label = 'ycs_spx', { toggles = false } = {}) {
  const prefix = normalize(baseUrl, stages), pages = {};
  const gridSize = { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 3 };
  function stageRow(stage) {
    const row = { 0: button(stage.id, stage.title || stage.id, colors.label) };
    const controls = toggles ? [
      ['ticker', 'toggle', 'TICKER\nON / OFF'], ['ticker', 'update', 'TICKER\nUPDATE'],
      ['lower-third', 'toggle', 'LOWER THIRD\nON / OFF'], ['lower-third', 'update', 'LOWER THIRD\nUPDATE'],
      [null, 'clear', 'STOP\nSTAGE']
    ] : actions;
    controls.forEach(([graphic, action, text], index) => {
      const uri = graphic ? `/api/ycs/stages/${stage.id}/graphics/${graphic}/${action}` : `/api/ycs/stages/${stage.id}/clear`;
      row[index + 1] = button(`${stage.id}-${graphic || 'stage'}-${action}`, text, colors[action], uri);
    }); return row;
  }
  // Each stage also has its own self-contained page for a switch-PC import.
  for (const [index, stage] of stages.entries()) pages[index + 1] = { id: `ycs-${stage.id}`, name: `${stage.title || stage.id} · Graphics`, gridSize, pageVariables: [], controls: { 0: stageRow(stage) } };
  for (let index = 0; index < stages.length; index += 3) pages[stages.length + 1 + index / 3] = {
    id: `ycs-overview-${index / 3}`, name: 'YCS · Stage overview' + (index ? ` ${index / 3 + 1}` : ''), gridSize, pageVariables: [],
    controls: Object.fromEntries(stages.slice(index, index + 3).map((stage, row) => [row, stageRow(stage)]))
  };
  return { version: 12, type: 'full', companionBuild: '5.1.1+10000-stable-1e2454ae78', pages,
    instances: { [connectionId]: { moduleInstanceType: 'connection', moduleId: 'generic-http', moduleVersionId: '3.2.0', updatePolicy: 'stable', sortOrder: 0, label, isFirstInit: false, config: { prefix, proxyAddress: '', authType: 'none', authUser: '', rejectUnauthorized: true, insecureHTTPParser: false }, lastUpgradeIndex: 3, enabled: true } }, connectionCollections: [] };
}
async function generate(root, stages) {
  const folder = path.join(root, 'dist/companion'); await fs.mkdir(folder, { recursive: true });
  const files = [];
  for (const [name, base, label] of [['YCS-Rehearsal', 'http://127.0.0.1:5661', 'ycs_rehearsal'], ['YCS-Orlando', 'http://127.0.0.1:5660', 'ycs_orlando']]) {
    for (const toggles of [false, true]) {
      const variant = name + (toggles ? '-Toggle' : '');
      const full = build(base, stages, label, { toggles }), fullFile = path.join(folder, variant + '.companionconfig');
      await fs.writeFile(fullFile, JSON.stringify(full, null, 2)); files.push(fullFile);
      for (const [index, stage] of stages.entries()) {
        const file = path.join(folder, `${variant}-${stage.id}.companionconfig`);
        await fs.writeFile(file, JSON.stringify({ version: full.version, type: 'page', companionBuild: full.companionBuild, page: full.pages[index + 1], oldPageNumber: index + 1, instances: full.instances, connectionCollections: [] }, null, 2)); files.push(file);
      }
    }
  }
  return files;
}
if (require.main === module) (async () => {
  const root = path.resolve(__dirname, '../..'), config = JSON.parse(await fs.readFile(path.resolve(root, process.argv[2] || '.local/ycs-dev.json'), 'utf8'));
  console.log((await generate(root, config.ycs.stages)).join('\n'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build, generate };
