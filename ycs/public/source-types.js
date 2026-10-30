// The server and mapping UI use the same source-format classification.
(function (root) {
  'use strict';
  const types = Object.freeze({
    'google-sheets': { label: 'Google Sheets', format: 'sheet' },
    'json-api': { label: 'JSON API', format: 'json' },
    'local-json': { label: 'Local JSON', format: 'json', local: true },
    'local-csv': { label: 'Local CSV', format: 'sheet', local: true }
  });
  const definition = (value) => {
    const type = typeof value === 'string' ? value : value?.type;
    return Object.hasOwn(types, type) ? types[type] : undefined;
  };
  const api = Object.freeze({
    supported: (value) => Boolean(definition(value)),
    isJSON: (value) => definition(value)?.format === 'json',
    isTable: (value) => definition(value)?.format === 'sheet',
    isLocal: (value) => definition(value)?.local === true,
    label: (value) => definition(value)?.label || 'Unknown source'
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YCSSourceTypes = api;
})(globalThis);
