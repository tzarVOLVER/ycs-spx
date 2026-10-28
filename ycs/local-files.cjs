'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { columnName, usable } = require('./public-sheets.cjs');

const MAX_BYTES = 1048576;
const TABLE_RANGE = 'A1:AF200';
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function localFileType(name) {
  if (typeof name !== 'string' || !/^[^<>:"/\\|?*\u0000-\u001f]{1,180}\.(json|csv)$/i.test(name))
    fail('Choose a JSON or CSV filename from the SPX data folder');
  return name.toLowerCase().endsWith('.json') ? 'local-json' : 'local-csv';
}
function normalizeLocalSettings(input, type) {
  if (localFileType(input?.file) !== type) fail('The selected file does not match the source type');
  const refreshSeconds = Number(input.refreshSeconds);
  if (!Number.isInteger(refreshSeconds) || refreshSeconds < 5 || refreshSeconds > 3600)
    fail('Refresh interval must be 5–3600 seconds');
  const settings = { file: input.file, refreshSeconds };
  if (type === 'local-csv') {
    const delimiter = input.delimiter ?? ',';
    if (![',', ';', '\t'].includes(delimiter)) fail('Choose a comma, semicolon or tab delimiter');
    Object.assign(settings, { delimiter, range: TABLE_RANGE });
  }
  return settings;
}

// Keep CSV as an addressable grid: headers and record layout belong to mappings.
// Quoted delimiters/newlines and doubled quotes follow CSV escaping rules.
function parseCSV(raw, delimiter = ',') {
  if (![',', ';', '\t'].includes(delimiter)) fail('Unsupported CSV delimiter');
  raw = raw.replace(/^\uFEFF/, '');
  const records = [];
  let row = [],
    value = '',
    quoted = false,
    closed = false,
    atStart = true;
  function cell() {
    if (value.length > 4000) fail('CSV cells must contain at most 4000 characters');
    row.push(value);
    if (row.length > 32) fail('CSV files support at most 32 columns');
    value = '';
    atStart = true;
    closed = false;
  }
  function record() {
    cell();
    records.push(row);
    row = [];
    if (records.length > 200) fail('CSV files support at most 200 rows, including headers');
  }
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (char === '"') {
        if (raw[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === delimiter) cell();
    else if (char === '\n' || char === '\r') {
      record();
      if (char === '\r' && raw[index + 1] === '\n') index++;
    } else if (char === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else {
      if (closed || char === '"') fail('CSV quoting is invalid');
      value += char;
      atStart = false;
    }
    if (value.length > 4000) fail('CSV cells must contain at most 4000 characters');
  }
  if (quoted) fail('CSV has an unclosed quoted value');
  if (row.length || value || closed || !atStart) record();
  if (!records.length) fail('CSV file is empty');
  const width = Math.max(...records.map((row) => row.length));
  return records.map((row, i) =>
    Array.from({ length: width }, (_, j) => {
      const value = row[j] ?? '';
      return { address: columnName(j + 1) + (i + 1), value, usable: usable(value) };
    })
  );
}

class LocalFiles {
  constructor(root) {
    this.root = path.resolve(root);
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const files = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        files.push({ name: entry.name, type: localFileType(entry.name) });
      } catch {
        /* Only explicitly supported data files are offered. */
      }
    }
    return { folder: this.root, files: files.sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async read(input, { signal, type = localFileType(input?.file) } = {}) {
    const settings = normalizeLocalSettings(input, type);
    let file;
    try {
      signal?.throwIfAborted();
      const root = await fs.realpath(this.root),
        candidate = path.join(root, settings.file);
      const link = await fs.lstat(candidate);
      if (!link.isFile() || link.isSymbolicLink())
        fail('Select a regular data file inside the SPX data folder');
      const resolved = await fs.realpath(candidate);
      if (path.dirname(resolved) !== root) fail('Data file must stay inside the SPX data folder');
      file = await fs.open(resolved, 'r');
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES)
        fail('Local files must be regular files up to 1 MB');
      // A bounded read also handles a file growing while another application writes it.
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        signal?.throwIfAborted();
        const result = await file.read(bytes, size, bytes.length - size, null);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size > MAX_BYTES) fail('Local files must be up to 1 MB');
      let raw;
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
      } catch {
        fail('Save the local file as UTF-8');
      }
      if (type === 'local-json') {
        let data;
        try {
          data = JSON.parse(raw.replace(/^\uFEFF/, ''));
        } catch {
          fail('Local file contains invalid JSON');
        }
        return { settings, data };
      }
      const rows = parseCSV(raw, settings.delimiter);
      return { settings, rows, headerRows: rows.map((_, index) => index + 1) };
    } catch (error) {
      if (error.status || signal?.aborted) throw error;
      fail('Local file is unavailable; check that it exists in the SPX data folder', 422);
    } finally {
      await file?.close();
    }
  }
}
module.exports = {
  LocalFiles,
  normalizeLocalSettings,
  parseCSV,
  localFileType,
  MAX_BYTES,
  TABLE_RANGE
};
