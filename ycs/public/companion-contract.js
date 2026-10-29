(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YCSCompanion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
  const actions = ['select', 'play', 'stop', 'toggle', 'update', 'preview', 'continue'];
  function command(project, rundown, item, action) {
    if (
      ![project, rundown, item].every(
        (value) => typeof value === 'string' && identifier.test(value)
      )
    )
      throw new Error('Invalid project, rundown or item ID');
    if (action === 'focus') action = 'select';
    if (!actions.includes(action)) throw new Error('Unknown item action');
    return {
      method: 'POST',
      path: '/api/' + [project, rundown, item, action].map(encodeURIComponent).join('/'),
      body: '{}',
      contentType: 'application/json'
    };
  }
  return { command, actions };
});
