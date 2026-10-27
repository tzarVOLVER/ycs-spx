'use strict';
const { parseRange, usable } = require('./public-sheets.cjs');
function fail(message) { const error = new Error(message); error.status = 400; throw error; }
function selection(input, settings) {
  if (input?.kind === 'cell') {
    const cell = parseRange(input.cell), range = parseRange(settings.range);
    if (cell.firstRow !== cell.lastRow || cell.firstColumn !== cell.lastColumn || cell.firstRow < range.firstRow || cell.lastRow > range.lastRow || cell.firstColumn < range.firstColumn || cell.lastColumn > range.lastColumn) fail('Choose a cell inside the connection range');
    return { kind: 'cell', cell: cell.a1 };
  }
  if (input?.kind !== 'row' || !['keyColumn', 'keyValue', 'valueColumn'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].length <= 300)) fail('Choose a key column, row value and value column');
  const range = parseRange(settings.range), headerRow = Number(input.headerRow || range.firstRow);
  if (!Number.isInteger(headerRow) || headerRow < range.firstRow || headerRow >= range.lastRow) fail('The header row must be inside the connection range, before its data rows');
  return { kind: 'row', headerRow, keyColumn: input.keyColumn, keyValue: input.keyValue, valueColumn: input.valueColumn };
}
function resolve(rows, pick) {
  if (!Array.isArray(rows)) throw new Error('Waiting for the first successful read');
  let cell;
  if (pick.kind === 'cell') cell = rows.flat().find(cell => cell.address === pick.cell);
  else {
    const headers = rows.find(row => row.some(cell => Number(cell.address.match(/\d+$/)?.[0]) === pick.headerRow));
    if (!headers) throw new Error('Header row is missing');
    const column = name => {
      const matches = headers.map((cell, index) => cell.value === name ? index : -1).filter(index => index >= 0);
      if (matches.length !== 1) throw new Error('Column is missing or duplicated: ' + name);
      return matches[0];
    };
    const key = column(pick.keyColumn), value = column(pick.valueColumn);
    const matches = rows.filter(row => Number(row[0]?.address.match(/\d+$/)?.[0]) > pick.headerRow && row[key]?.value === pick.keyValue);
    if (matches.length !== 1) throw new Error(matches.length ? 'More than one row matches this key' : 'No row matches this key');
    cell = matches[0][value];
  }
  if (!cell || !usable(cell.value) || cell.usable === false) throw new Error('Selected value is empty or exceeds 300 characters');
  return cell.value;
}
module.exports = { selection, resolve };
