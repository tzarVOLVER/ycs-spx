'use strict';
// Browser playout uses WebSockets rather than one HTTP event stream per mode.
// Three stage controllers plus their previews must not exhaust HTTP/1 slots.
module.exports = function attachSockets(io, playback, config) {
  const namespace = io.of('/ycs-playback'), listeners = [];
  namespace.use((socket, next) => {
    const request = socket.request, origin = request.headers.origin;
    const expected = `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
    const operator = request.session?.user && request.session.user === config.general.username;
    const key = config.ycs.apiKey;
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
    if ((origin && origin !== expected) || (!operator && (key ? socket.handshake.auth?.token !== key : !local))) return next(new Error('Stage connection not authorized'));
    next();
  });
  for (const stage of playback.repository.stages.values()) for (const mode of ['program', 'preview']) {
    const event = `${stage.id}:${mode}`, listener = snapshot => namespace.to(event).emit('state', snapshot);
    playback.on(event, listener); listeners.push([event, listener]);
  }
  for (const stage of playback.repository.stages.values()) {
    const event = stage.id + ':focus';
    const listener = selection => namespace.to(event).emit('focus', selection);
    playback.on(event, listener); listeners.push([event, listener]);
  }
  namespace.on('connection', socket => {
    socket.on('subscribe', payload => {
      try {
        if (!payload || !Array.isArray(payload.modes) || payload.modes.length < 1 || payload.modes.length > 2 || new Set(payload.modes).size !== payload.modes.length) throw new Error('Invalid stage subscription');
        const snapshots = payload.modes.map(mode => playback.snapshot(payload.stage, mode));
        for (const room of socket.data.stageRooms || []) socket.leave(room);
        socket.data.stageRooms = snapshots.map(snapshot => `${snapshot.stage}:${snapshot.mode}`);
        if (payload.controller === true) socket.data.stageRooms.push(payload.stage + ':focus');
        for (const room of socket.data.stageRooms) socket.join(room);
        for (const snapshot of snapshots) socket.emit('state', snapshot);
      } catch { socket.emit('stage-error', { error: 'Unknown stage or output mode' }); }
    });
  });
  return () => { for (const [event, listener] of listeners) playback.off(event, listener); namespace.disconnectSockets(true); };
};
