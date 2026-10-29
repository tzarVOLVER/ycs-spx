'use strict';
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
function scope(stage, mode) {
  return typeof stage === 'string' &&
    identifier.test(stage) &&
    ['program', 'preview'].includes(mode)
    ? stage + ':' + mode
    : null;
}
function grant(request, stage, mode) {
  const key = scope(stage, mode);
  if (!request.session || !key) return;
  request.session.ycsOutputs = [...new Set([...(request.session.ycsOutputs || []), key])].slice(
    -40
  );
}
function allowed(request, config, stage, mode) {
  const user = request.session?.user;
  const authenticated = config.general.username
    ? user === config.general.username
    : user === 'default';
  const key = scope(stage, mode);
  return Boolean(authenticated && key && request.session?.ycsOutputs?.includes(key));
}
module.exports = { scope, grant, allowed };
