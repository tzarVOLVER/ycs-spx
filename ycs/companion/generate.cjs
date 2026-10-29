'use strict';
// Companion 5.1 export format. Profiles contain commands and labels only.
const fs = require('node:fs/promises');
const path = require('node:path');
const { command } = require('../public/companion-contract.js');
const value = (value) => ({ value, isExpression: false });
const connectionId = 'ycs-spx-http';
const colors = {
  play: 0x17693c,
  toggle: 0x655097,
  update: 0x125a86,
  stop: 0x922c36,
  clear: 0x721e2a,
  label: 0x273944
};
function button(id, text, color, uri) {
  const geometry = {
    enabled: value(true),
    opacity: value(100),
    x: value(0),
    y: value(0),
    width: value(100),
    height: value(100),
    rotation: value(0)
  };
  return {
    type: 'button-layered',
    options: {
      stepProgression: 'auto',
      stepExpression: '',
      rotaryActions: false,
      canModifyStyleInApis: false,
      notes: uri
        ? `Explicit stage command: ${uri}. Empty body uses saved rundown fields; use the rundown for edits. Colors identify actions, not live program state.`
        : 'Stage label; no playout action.'
    },
    style: {
      layers: [
        {
          id: 'canvas',
          name: 'Canvas',
          usage: 'auto',
          type: 'canvas',
          decoration: value('default'),
          showStatusIcons: value('all')
        },
        {
          id: 'background',
          name: 'Background',
          type: 'box',
          usage: 'auto',
          pinnedProperties: ['color'],
          ...geometry,
          color: value(color),
          cornerRadius: value(5),
          borderWidth: value(0),
          borderColor: value(0),
          borderPosition: value('inside')
        },
        {
          id: 'label',
          name: 'Text',
          type: 'text',
          usage: 'auto',
          pinnedProperties: ['text', 'fontsize', 'color'],
          ...geometry,
          x: value(5),
          y: value(10),
          width: value(90),
          height: value(80),
          text: value(text),
          color: value(0xffffff),
          halign: value('center'),
          valign: value('center'),
          fontsize: value(22),
          fontsizeAllowShrink: value(true),
          font: value('companion-sans'),
          weight: value('bold'),
          styles: value([]),
          outlineColor: value(0xff000000)
        }
      ]
    },
    feedbacks: [],
    localVariables: [],
    steps: {
      0: {
        options: { runWhileHeld: [] },
        action_sets: {
          down: uri
            ? [
                {
                  id: `action-${id}`,
                  type: 'action',
                  definitionId: 'post',
                  connectionId,
                  upgradeIndex: 3,
                  options: {
                    url: value(uri),
                    body: value('{}'),
                    header: value(''),
                    contenttype: value('application/json'),
                    result_stringify: value(true),
                    jsonResultDataVariable: { isExpression: false },
                    statusCodeVariable: { isExpression: false }
                  }
                }
              ]
            : [],
          up: []
        }
      }
    }
  };
}
function origin(baseUrl) {
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error('Use an HTTP(S) server origin without credentials, path, query or fragment');
  return url.origin;
}
function caption(value, fallback) {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 100);
}
function validateStages(stages) {
  if (
    !Array.isArray(stages) ||
    !stages.length ||
    stages.length > 20 ||
    new Set(stages.map((stage) => stage.id)).size !== stages.length
  )
    throw new Error('Choose up to 20 distinct configured stages');
  for (const stage of stages) {
    command(stage.id, null, 'clear');
    if (!Array.isArray(stage.graphics) || !stage.graphics.length || stage.graphics.length > 200)
      throw new Error(`${stage.title || stage.id}: choose a rundown with 1–200 graphic items`);
    if (new Set(stage.graphics.map((item) => item.id)).size !== stage.graphics.length)
      throw new Error(`${stage.id}: rundown graphic IDs must be unique`);
    for (const item of stage.graphics) {
      command(stage.id, item.id, 'play');
      if (typeof item.slot !== 'string' || !item.slot)
        throw new Error(`${stage.id} / ${item.id}: graphic has no configured output slot`);
    }
  }
}
async function loadStages(repository, slots, stageId) {
  const stages = stageId ? [repository.stage(stageId)] : [...repository.stages.values()];
  const result = [];
  for (const stage of stages) {
    const rundown = await repository.read(stage.id);
    const graphics = rundown.templates.map((item) => {
      if (!Object.hasOwn(slots, item.ycsSlot))
        throw new Error(
          `${stage.title || stage.id} / ${item.ycsNickname || item.itemID}: graphic has no configured output slot`
        );
      if (
        typeof item.relpath !== 'string' ||
        !/^\/[a-zA-Z0-9_./-]+\.html?$/.test(item.relpath) ||
        item.relpath.split('/').includes('..')
      )
        throw new Error(`${stage.id} / ${item.itemID}: unsupported template path`);
      return {
        id: item.itemID,
        title: caption(item.ycsNickname || item.description, path.basename(item.relpath)),
        slot: item.ycsSlot
      };
    });
    result.push({ id: stage.id, title: caption(stage.title, stage.id), graphics });
  }
  validateStages(result);
  return result;
}
function build(baseUrl, stages, label = 'ycs_spx', { toggles = false, overview = true } = {}) {
  const prefix = origin(baseUrl);
  validateStages(stages);
  const pages = {},
    gridSize = { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 3 };
  function controls(stage, item, overview = false) {
    const title = caption(item.title, item.id);
    const row = {
      0: button(
        `${stage.id}-${item.id}`,
        overview ? caption(stage.title, stage.id) + '\n' + title : title,
        colors.label
      )
    };
    const actions = toggles ? ['toggle', 'update', 'play', 'stop'] : ['play', 'update', 'stop'];
    actions.forEach((action, index) => {
      row[index + 1] = button(
        `${stage.id}-${item.id}-${action}`,
        action === 'toggle' ? 'ON / OFF' : action.toUpperCase(),
        colors[action],
        command(stage.id, item.id, action).path
      );
    });
    if (overview)
      row[7] = button(
        `${stage.id}-clear`,
        'STOP\n' + caption(stage.title, stage.id),
        colors.clear,
        command(stage.id, null, 'clear').path
      );
    return row;
  }
  let nextPage = 1;
  for (const stage of stages) {
    for (let start = 0; start < stage.graphics.length; start += 3) {
      const part = start / 3 + 1,
        header = {
          0: button(stage.id, caption(stage.title, stage.id), colors.label),
          7: button(
            `${stage.id}-clear`,
            'STOP\nSTAGE',
            colors.clear,
            command(stage.id, null, 'clear').path
          )
        };
      pages[nextPage++] = {
        id: `ycs-${stage.id}-${part}`,
        name: `${caption(stage.title, stage.id)} · Graphics${part === 1 ? '' : ' ' + part}`,
        gridSize,
        pageVariables: [],
        controls: {
          0: header,
          ...Object.fromEntries(
            stage.graphics
              .slice(start, start + 3)
              .map((item, index) => [index + 1, controls(stage, item)])
          )
        }
      };
    }
  }
  // Overview pages use the same real item IDs, including multiple copies of a
  // template. Each row explicitly identifies its output and item.
  const all = stages.flatMap((stage) => stage.graphics.map((item) => ({ stage, item })));
  for (let start = 0; overview && start < all.length; start += 4) {
    pages[nextPage++] = {
      id: `ycs-overview-${start / 4 + 1}`,
      name: 'YCS · Overview' + (start ? ' ' + (start / 4 + 1) : ''),
      gridSize,
      pageVariables: [],
      controls: Object.fromEntries(
        all
          .slice(start, start + 4)
          .map(({ stage, item }, index) => [index, controls(stage, item, true)])
      )
    };
  }
  return {
    version: 12,
    type: 'full',
    companionBuild: '5.1.1+10000-stable-1e2454ae78',
    pages,
    instances: {
      [connectionId]: {
        moduleInstanceType: 'connection',
        moduleId: 'generic-http',
        moduleVersionId: '3.2.0',
        updatePolicy: 'stable',
        sortOrder: 0,
        label,
        isFirstInit: false,
        config: {
          prefix,
          proxyAddress: '',
          authType: 'none',
          authUser: '',
          rejectUnauthorized: true,
          insecureHTTPParser: false
        },
        lastUpgradeIndex: 3,
        enabled: true
      }
    },
    connectionCollections: []
  };
}
function pageExport(full, number) {
  if (!Number.isInteger(number) || !full.pages[number])
    throw new Error('Choose an existing Companion page number');
  return {
    version: full.version,
    type: 'page',
    companionBuild: full.companionBuild,
    page: full.pages[number],
    oldPageNumber: number,
    instances: full.instances,
    connectionCollections: []
  };
}
async function generate(root, config, { baseUrl, name = 'YCS-Orlando' } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))
    throw new Error('Use a simple export filename');
  const { RundownRepository } = require('../playback.cjs');
  const repository = new RundownRepository(
    path.resolve(root, config.general.dataroot),
    config.ycs.stages
  );
  const stages = await loadStages(repository, config.ycs.slots);
  const base = origin(baseUrl || `http://127.0.0.1:${config.general.port}`);
  const exports = [];
  for (const toggles of [false, true]) {
    const variant = name + (toggles ? '-Toggle' : ''),
      full = build(base, stages, 'ycs_spx', { toggles });
    exports.push([variant + '.companionconfig', full]);
    for (const [number, page] of Object.entries(full.pages))
      exports.push([
        variant + '-' + page.id + '.companionconfig',
        pageExport(full, Number(number))
      ]);
  }
  const folder = path.join(root, 'dist/companion');
  await fs.mkdir(folder, { recursive: true });
  for (const [file, data] of exports)
    await fs.writeFile(path.join(folder, file), JSON.stringify(data, null, 2));
  return exports.map(([file]) => path.join(folder, file));
}
if (require.main === module)
  (async () => {
    const root = path.resolve(__dirname, '../..'),
      args = process.argv.slice(2);
    const configFile = args[0] && !args[0].startsWith('--') ? args.shift() : '.local/ycs-dev.json';
    const options = {};
    while (args.length) {
      const flag = args.shift(),
        value = args.shift();
      if (!value || !['--base-url', '--name'].includes(flag))
        throw new Error(
          'Usage: node ycs/companion/generate.cjs CONFIG [--base-url http://SPX-PC:5660] [--name YCS-Orlando]'
        );
      options[flag === '--base-url' ? 'baseUrl' : 'name'] = value;
    }
    const config = JSON.parse(await fs.readFile(path.resolve(root, configFile), 'utf8'));
    console.log((await generate(root, config, options)).join('\n'));
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { build, generate, loadStages, pageExport };
