'use strict';
// Explicit migration while SPX is stopped. Keep every saved field, link and
// graphic identity; migrate template-default keys together with import paths.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const SHARED = '/ycs/ticker/ticker.html';
const legacy = value => /^\/ycs\/ticker\/YCS-Ticker-[123]\.html$/.test(value);

async function migrate(root, config) {
  await fs.access(path.resolve(root, config.ycs.graphicsRoot, 'ticker.html'));
  const plans = new Map();
  for (const stage of config.ycs.stages) for (const relative of ['profile.json', `data/${stage.rundown}.json`]) {
    const file = path.resolve(root, config.general.dataroot, stage.project, relative);
    if (plans.has(file)) continue;
    const raw = await fs.readFile(file, 'utf8'), document = JSON.parse(raw);
    let changed = false;
    for (const item of document.templates || []) if (legacy(item.relpath)) {
      item.relpath = SHARED;
      // Old f0 is retained as hidden compatibility metadata. The shared HTML
      // ignores it; the stage URL, never f0, determines the output destination.
      item.ycsEditRevision = (item.ycsEditRevision || 0) + 1;
      changed = true;
    }
    if (changed) plans.set(file, { raw, document });
  }
  const dataFile = path.resolve(root, config.ycs.dataFile || path.join(config.general.dataroot, '../ycs-data.json'));
  try {
    const raw = await fs.readFile(dataFile, 'utf8'), document = JSON.parse(raw);
    const stages = new Set(config.ycs.stages.map(stage => stage.id));
    let changed = false;
    const defaults = [], keys = new Map();
    for (const original of document.defaults || []) {
      const entry = structuredClone(original);
      if (stages.has(entry.stage) && legacy(entry.template)) { entry.template = SHARED; changed = true; }
      const key = JSON.stringify([entry.stage, entry.template, entry.field]);
      if (keys.has(key)) {
        if (JSON.stringify(keys.get(key)) !== JSON.stringify(entry)) throw new Error('Conflicting template defaults; resolve them before migrating');
        changed = true;
      } else { keys.set(key, entry); defaults.push(entry); }
    }
    if (changed) {
      if (document.version !== 2 || !Number.isSafeInteger(document.revision)) throw new Error('Upgrade the data document to version 2 first');
      document.defaults = defaults; document.revision++;
      plans.set(dataFile, { raw, document });
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Plan and validate every document before the first write. Backups are exact
  // and never replaced by later runs; rollback restores originals on failure.
  for (const [file, { raw }] of plans) await fs.writeFile(file + '.before-shared-ticker.json', raw, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const written = [];
  try {
    for (const [file, { document }] of plans) {
      await fs.writeFile(file + '.shared-tmp', JSON.stringify(document, null, 2));
      await fs.rename(file + '.shared-tmp', file); written.push(file);
    }
  } catch (error) {
    for (const file of written.reverse()) await fs.writeFile(file, plans.get(file).raw);
    throw error;
  }
  return [...plans.keys()];
}
function listening(port) {
  return new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
}
if (require.main === module) (async () => {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(await fs.readFile(path.resolve(root, process.argv[2] || '.local/ycs-dev.json'), 'utf8'));
  if (await listening(config.general.port)) throw new Error('Stop the configured SPX server before migrating saved imports');
  console.log(`Shared ticker migration: ${(await migrate(root, config)).length} files updated; exact backups retained.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate, SHARED };
