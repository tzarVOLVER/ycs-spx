'use strict';
const express = require('express');
const path = require('node:path');
const { Playback, RundownRepository } = require('./playback.cjs');

module.exports = function registerYCS(app, config, hooks = {}) {
  if (!config.ycs?.enabled) return;
  const settings = config.ycs;
  const repository = new RundownRepository(config.general.dataroot, settings.stages);
  const playback = new Playback(repository, settings.slots);
  const auth = hooks.auth || require('../utils/spx_auth.js');
  const router = express.Router();
  const handlers = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-origin commands are not accepted' });
    next();
  }
  function apiAccess(req, res, next) {
    // Browser operator sessions use normal SPX login. Companion can use a header.
    const operator = req.session?.user && req.session.user === config.general.username;
    if (operator) return next();
    if (settings.apiKey) {
      if (req.get('authorization') !== `Bearer ${settings.apiKey}`) return res.status(401).json({ error: 'API token required' });
    } else if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      return res.status(403).json({ error: 'Remote API requires a configured token or operator login' });
    }
    next();
  }

  app.use('/ycs', express.static(path.join(__dirname, 'public')));
  if (settings.graphicsRoot) app.use('/templates/ycs/ticker', express.static(path.resolve(settings.graphicsRoot)));
  app.use('/templates/ycs-system', express.static(path.join(__dirname, 'templates')));
  app.get('/output/:stage/:mode', auth.CheckLogin, handlers(async (req, res) => {
    playback.snapshot(req.params.stage, req.params.mode);
    res.sendFile(path.join(__dirname, 'public/output.html'));
  }));
  router.use(sameOrigin, apiAccess);
  router.get('/stages', (req, res) => res.json([...repository.stages.values()].map(({ id, title, project, rundown }) => ({ id, title, controller: `/gc/${project}/${rundown}` }))));
  router.get('/stages/:stage/graphics', handlers(async (req, res) => res.json(await playback.catalog(req.params.stage))));
  router.get('/stages/:stage/:mode/state', handlers(async (req, res) => res.json(playback.snapshot(req.params.stage, req.params.mode))));
  router.get('/stages/:stage/:mode/events', (req, res, next) => {
    try {
      const { stage, mode } = req.params;
      const state = playback.snapshot(stage, mode);
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders();
      const send = value => res.write(`event: state\ndata: ${JSON.stringify(value)}\n\n`);
      send(state);
      const eventName = stage + ':' + mode;
      playback.on(eventName, send);
      const heartbeat = setInterval(() => res.write(': connected\n\n'), 15000);
      heartbeat.unref();
      req.on('close', () => { clearInterval(heartbeat); playback.off(eventName, send); });
    } catch (error) { next(error); }
  });
  router.post('/stages/:stage/graphics/:graphic/:action', handlers(async (req, res) => {
    res.json(await playback.command(req.params.stage, req.params.graphic, req.params.action, req.body?.fields));
  }));
  router.post('/stages/:stage/clear', handlers(async (req, res) => res.json(await playback.clear(req.params.stage))));
  app.use('/api/ycs', router);

  // Preserve the familiar SPX editor and keyboard/Save/Play/Update controls.
  // Requests for configured stages bypass legacy shared global.rundownData.
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.startsWith('/gc/')) {
      const parts = req.path.split('/');
      const stage = [...repository.stages.values()].find(stage => stage.project === parts[2] && stage.rundown === parts[3]);
      if (stage) res.locals.ycsStage = { id: stage.id, title: stage.title, previewUrl: `/output/${stage.id}/preview` };
    }
    if (req.method !== 'POST' || !['/gc/playout', '/gc/saveItemChanges'].includes(req.path)) return next();
    const stage = repository.matchFile(req.body?.datafile || req.body?.rundownfile);
    if (!stage) return next();
    sameOrigin(req, res, () => auth.CheckLogin(req, res, () => handlers(async () => {
      if (req.path === '/gc/saveItemChanges') {
        await playback.command(stage.id, req.body.epoch, 'save', req.body.DataFields);
        const saved = repository.item(await repository.read(stage.id), req.body.epoch);
        const summary = saved.DataFields.filter(field => field.field && field.ftype !== 'hidden').slice(0, 2).map(field => String(field.value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])).join(' | ');
        return res.json(['Stage changes saved', summary]);
      }
      const action = req.body.command;
      if (action === 'autoPlayLocal') return res.json({ skipped: true });
      if (!['play', 'stop', 'preview', 'update', 'continue'].includes(action)) return res.status(400).json({ error: 'This command is not supported for a YCS stage' });
      await playback.command(stage.id, req.body.epoch, action, req.body.fields);
      return res.type('text').send(`${stage.title || stage.id}: ${action} ${req.body.epoch}`);
    })(req, res, next)));
  });
  app.use((error, req, res, next) => {
    if (!req.path.startsWith('/api/ycs') && !req.path.startsWith('/output') && !repository.matchFile(req.body?.datafile || req.body?.rundownfile)) return next(error);
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Stage operation failed; program state retained' });
  });
  return playback;
};
