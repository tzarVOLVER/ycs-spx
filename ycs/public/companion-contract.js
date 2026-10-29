(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YCSCompanion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
  const actions = ['play', 'stop', 'toggle', 'update'];
  function command(stage, item, action) {
    if (!identifier.test(stage) || typeof stage !== 'string') throw new Error('Invalid stage ID');
    const clear = item === null && action === 'clear';
    if (!clear && (typeof item !== 'string' || !identifier.test(item) || !(actions.includes(action) || action === 'continue')))
      throw new Error('Invalid Companion item or action');
    return {
      method: 'POST',
      path: '/api/ycs/stages/' + stage + (clear ? '/clear' : '/graphics/' + item + '/' + action),
      body: '{}',
      contentType: 'application/json'
    };
  }
  return { command, actions };
});
