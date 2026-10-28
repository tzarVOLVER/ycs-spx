'use strict';
const express = require('express');
const path = require('node:path');
const { Playback, RundownRepository, prepareEdits } = require('./playback.cjs');
const { DataSources, linkable } = require('./data.cjs');
const { LocalFiles } = require('./local-files.cjs');
const { Renderers } = require('./renderers.cjs');

module.exports = function registerYCS(app, config, hooks = {}) {
  if (!config.ycs?.enabled) return;
  const settings = config.ycs;
  const repository = new RundownRepository(config.general.dataroot, settings.stages);
  const sources = new DataSources(
    settings.dataFile || path.resolve(config.general.dataroot, '../ycs-data.json'),
    settings.stages,
    {
      sheets: hooks.sheets,
      json: hooks.json,
      localFiles:
        hooks.localFiles ||
        new LocalFiles(
          settings.localDataRoot || path.resolve(config.general.dataroot, '../data-sources'),
          { locations: settings.localDataLocations || [] }
        )
    }
  );
  const playback = new Playback(repository, settings.slots, sources);
  const renderers = new Renderers();
  sources.activeReferences = () =>
    [...playback.states].flatMap(([stage, state]) =>
      state.program.flatMap((graphic) =>
        Object.entries(graphic.links || {})
          .filter(([, link]) => link.mode === 'linked')
          .map(([field, link]) => ({ stage, graphic: graphic.id, field, source: link.source }))
      )
    );
  let closeSockets;
  playback.attachSockets = (io) => {
    closeSockets = require('./sockets.cjs')(io, playback, config);
  };
  const updateLinks = () => {
    for (const stage of settings.stages)
      playback.refreshLinks(stage.id).catch((error) => console.error('[YCS data]', error.message));
  };
  sources.on('change', updateLinks);
  sources.ready.catch((error) => console.error('[YCS data]', error.message));
  const sourceTimer = setInterval(
    () =>
      sources
        .refresh()
        .then(() => sources.pollSheets())
        .catch((error) => console.error('[YCS data]', error.message)),
    1000
  );
  sourceTimer.unref();
  playback.close = () => {
    clearInterval(sourceTimer);
    sources.off('change', updateLinks);
    sources.close();
    closeSockets?.();
  };
  const auth = hooks.auth || require('../utils/spx_auth.js');
  const router = express.Router();
  const handlers = (handler) => (req, res, next) =>
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);

  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`)
      return res.status(403).json({ error: 'Cross-origin commands are not accepted' });
    next();
  }
  function apiAccess(req, res, next) {
    // Browser operator sessions use normal SPX login. Companion can use a header.
    const operator = req.session?.user && req.session.user === config.general.username;
    if (operator) return next();
    if (settings.apiKey) {
      if (req.get('authorization') !== `Bearer ${settings.apiKey}`)
        return res.status(401).json({ error: 'API token required' });
    } else if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      return res
        .status(403)
        .json({ error: 'Remote API requires a configured token or operator login' });
    }
    next();
  }

  app.get('/ycs/data-manager', auth.CheckLogin, (req, res) =>
    res.sendFile(path.join(__dirname, 'public/data-manager.html'))
  );
  app.use('/ycs', express.static(path.join(__dirname, 'public')));
  if (settings.graphicsRoot)
    app.use('/templates/ycs/ticker', express.static(path.resolve(settings.graphicsRoot)));
  app.use('/templates/ycs-system', express.static(path.join(__dirname, 'templates')));
  app.get(
    '/output/:stage/:mode',
    auth.CheckLogin,
    handlers(async (req, res) => {
      playback.snapshot(req.params.stage, req.params.mode);
      res.sendFile(path.join(__dirname, 'public/output.html'));
    })
  );
  router.use(sameOrigin, apiAccess);
  router.get(
    '/data',
    handlers(async (req, res) => {
      await sources.ready;
      res.json(sources.snapshot());
    })
  );
  router.post(
    '/data/source',
    handlers(async (req, res) =>
      res.json(await sources.updateSource(req.body.id, req.body.value, req.body.revision))
    )
  );
  router.get(
    '/data/local/locations',
    handlers(async (req, res) => res.json(sources.localFiles.describe()))
  );
  router.post(
    '/data/local/test',
    handlers(async (req, res) =>
      res.json(await sources.localFiles.read(req.body.settings, { type: req.body.type }))
    )
  );
  router.post(
    '/data/json/test',
    handlers(async (req, res) => res.json(await sources.json.read(req.body.settings)))
  );
  router.post(
    '/data/sheets/test',
    handlers(async (req, res) => res.json(await sources.testSheet(req.body.settings)))
  );
  router.post(
    '/data/sheets/worksheets',
    handlers(async (req, res) => res.json(await sources.sheets.worksheets({ url: req.body.url })))
  );
  router.post(
    '/data/sheets',
    handlers(async (req, res) =>
      res.json(
        await sources.addSheet(
          req.body.label,
          req.body.settings,
          req.body.revision,
          req.body.type,
          req.body.project
        )
      )
    )
  );
  router.post(
    '/data/sheets/:id/refresh',
    handlers(async (req, res) => res.json(await sources.refreshSheet(req.params.id)))
  );
  router.post(
    '/data/mapping',
    handlers(async (req, res) => {
      const { stage, graphic, field, source, revision } = req.body;
      const item = repository.item(await repository.read(stage), graphic);
      if (!linkable(item, field))
        return res.status(422).json({ error: 'This template field does not support text linking' });
      res.json(await sources.updateMapping({ stage, graphic, field, source }, revision));
    })
  );
  router.post(
    '/data/connections',
    handlers(async (req, res) =>
      res.json(
        await sources.saveConnection(
          req.body.id,
          req.body.label,
          req.body.settings,
          req.body.revision,
          req.body.type,
          req.body.project
        )
      )
    )
  );
  router.post(
    '/data/connections/:id/refresh',
    handlers(async (req, res) => res.json(await sources.refreshSheet(req.params.id)))
  );
  router.post(
    '/data/connections/:id/remove',
    handlers(async (req, res) =>
      res.json(await sources.removeConnection(req.params.id, req.body.revision))
    )
  );
  router.get(
    '/data/mappings/:stage/:graphic',
    handlers(async (req, res) => {
      await sources.ready;
      const { stage, graphic } = req.params,
        item = repository.item(await repository.read(stage), graphic);
      res.json(await playback.mappingPreview(stage, graphic));
    })
  );
  router.post(
    '/data/mappings/:stage/:graphic/preview',
    handlers(async (req, res) =>
      res.json(await playback.mappingPreview(req.params.stage, req.params.graphic, req.body.edits))
    )
  );
  router.post(
    '/data/mappings/:stage/:graphic',
    handlers(async (req, res) => {
      const { stage, graphic } = req.params,
        item = repository.item(await repository.read(stage), graphic);
      if (
        !Array.isArray(req.body.edits) ||
        req.body.edits.some((edit) => !linkable(item, edit.field))
      )
        return res.status(422).json({ error: 'This field cannot be mapped' });
      res.json(
        await sources.saveMappings(
          stage,
          graphic,
          item.relpath,
          prepareEdits(item, req.body.edits),
          req.body.revision
        )
      );
    })
  );
  router.get('/stages', (req, res) =>
    res.json(
      [...repository.stages.values()].map(({ id, title, project, rundown }) => ({
        id,
        title,
        project,
        rundown,
        controller: `/gc/${project}/${rundown}`
      }))
    )
  );
  router.get(
    '/stages/:stage/graphics',
    handlers(async (req, res) => res.json(await playback.catalog(req.params.stage)))
  );
  router.get(
    '/stages/:stage/graphics/:graphic/editor',
    handlers(async (req, res) =>
      res.json(await playback.editor(req.params.stage, req.params.graphic))
    )
  );
  router.get(
    '/stages/:stage/health',
    handlers(async (req, res) =>
      res.json(renderers.snapshot(req.params.stage, playback.state(req.params.stage).revision))
    )
  );
  router.post(
    '/stages/:stage/:mode/report',
    handlers(async (req, res) => {
      playback.snapshot(req.params.stage, req.params.mode);
      renderers.report(req.params.stage, req.params.mode, req.body);
      res.sendStatus(204);
    })
  );
  router.get(
    '/stages/:stage/:mode/state',
    handlers(async (req, res) => res.json(playback.snapshot(req.params.stage, req.params.mode)))
  );
  router.get('/stages/:stage/:mode/events', (req, res, next) => {
    try {
      const { stage, mode } = req.params;
      const state = playback.snapshot(stage, mode);
      // Retire legacy browser streams without retry loops. Updated controllers
      // and outputs use the /ycs-playback Socket.IO namespace. Keep the stream
      // endpoint for explicit non-browser integrations and existing API tests.
      if (req.get('accept')?.includes('text/event-stream')) return res.sendStatus(204);
      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.flushHeaders();
      const send = (value) => res.write(`event: state\ndata: ${JSON.stringify(value)}\n\n`);
      send(state);
      const eventName = stage + ':' + mode;
      playback.on(eventName, send);
      const heartbeat = setInterval(() => res.write(': connected\n\n'), 15000);
      heartbeat.unref();
      req.on('close', () => {
        clearInterval(heartbeat);
        playback.off(eventName, send);
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/stages/:stage/graphics/:graphic/:action',
    handlers(async (req, res) => {
      res.json(
        await playback.command(
          req.params.stage,
          req.params.graphic,
          req.params.action,
          req.body?.fields,
          { links: req.body?.links, revision: req.body?.revision }
        )
      );
    })
  );
  router.post(
    '/stages/:stage/clear',
    handlers(async (req, res) => res.json(await playback.clear(req.params.stage)))
  );
  app.use('/api/ycs', router);

  // Preserve the familiar SPX editor and keyboard/Save/Play/Update controls.
  // Requests for configured stages bypass legacy shared global.rundownData.
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.startsWith('/gc/')) {
      const parts = req.path.split('/');
      const stage = [...repository.stages.values()].find(
        (stage) => stage.project === parts[2] && stage.rundown === parts[3]
      );
      if (stage)
        res.locals.ycsStage = {
          id: stage.id,
          title: stage.title,
          previewUrl: `/output/${stage.id}/preview`
        };
    }
    if (req.method !== 'POST' || !['/gc/playout', '/gc/saveItemChanges'].includes(req.path))
      return next();
    const stage = repository.matchFile(req.body?.datafile || req.body?.rundownfile);
    if (!stage) return next();
    sameOrigin(req, res, () =>
      auth.CheckLogin(req, res, () =>
        handlers(async () => {
          if (req.path === '/gc/saveItemChanges') {
            await playback.command(stage.id, req.body.epoch, 'save', req.body.DataFields);
            const saved = repository.item(await repository.read(stage.id), req.body.epoch);
            const summary = saved.DataFields.filter(
              (field) => field.field && field.ftype !== 'hidden'
            )
              .slice(0, 2)
              .map((field) =>
                String(field.value ?? '').replace(
                  /[&<>"']/g,
                  (character) =>
                    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
                      character
                    ]
                )
              )
              .join(' | ');
            return res.json(['Stage changes saved', summary]);
          }
          const action = req.body.command;
          if (action === 'autoPlayLocal') return res.json({ skipped: true });
          if (!['play', 'stop', 'preview', 'update', 'continue'].includes(action))
            return res.status(400).json({ error: 'This command is not supported for a YCS stage' });
          await playback.command(stage.id, req.body.epoch, action, req.body.fields);
          return res.type('text').send(`${stage.title || stage.id}: ${action} ${req.body.epoch}`);
        })(req, res, next)
      )
    );
  });
  app.use((error, req, res, next) => {
    if (
      !req.path.startsWith('/api/ycs') &&
      !req.path.startsWith('/output') &&
      !repository.matchFile(req.body?.datafile || req.body?.rundownfile)
    )
      return next(error);
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Stage operation failed; program state retained',
      ...(error.fields ? { fields: error.fields } : {})
    });
  });
  return playback;
};
