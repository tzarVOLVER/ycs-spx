const $ = id => document.getElementById(id);
let state, stages = [], mapping, catalog = [], loading = false, disposed = false, editingId = null, tested = '', draftRevision;
const rows = new Map();
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function option(select, value, title) { const result = node('option', title); result.value = value; select.append(result); }
function label(title, input) { const result = node('label', title); result.append(input); return result; }
function button(title, callback) { const result = node('button', title); result.type = 'button'; result.addEventListener('click', () => Promise.resolve(callback()).catch(error => message(error.message, true))); return result; }
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
async function request(url, body) { const response = await fetch('/api/ycs' + url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result; }
function showTab(name) { for (const tab of ['sources', 'mappings']) { $(tab + '-tab').setAttribute('aria-selected', String(name === tab)); $(tab + '-view').hidden = name !== tab; } }
$('sources-tab').onclick = () => showTab('sources'); $('mappings-tab').onclick = () => showTab('mappings');
function time(value) { return value ? new Date(value).toLocaleTimeString() : 'Waiting for first read'; }
function usageText(usage) { return `${stages.find(stage => stage.id === usage.stage)?.title || usage.stage} · ${usage.graphic || 'Template default'} · ${usage.field}${usage.kind === 'on-air' ? ' · ON AIR' : ''}`; }
function renderConnections() {
  const container = $('connections'); container.replaceChildren();
  for (const [id, connection] of Object.entries(state.connections || {})) {
    const card = node('article', undefined, 'connection'), top = node('div', undefined, 'connection-top'), badge = node('span', connection.health === 'ok' ? 'Connected' : connection.health === 'loading' ? 'Connecting' : 'Needs attention', 'status');
    badge.classList.toggle('warning', connection.health !== 'ok'); top.append(node('h3', connection.label), badge);
    const actions = node('div', undefined, 'connection-actions');
    actions.append(button('Refresh', async () => { state = await request(`/data/connections/${id}/refresh`, {}); renderConnections(); refreshValues(); }), button('Edit', () => openConnection(id)));
    const remove = button('Remove', async () => { state = await request(`/data/connections/${id}/remove`, { revision: state.revision }); renderConnections(); message('Connection removed.'); });
    remove.disabled = connection.usages.length > 0; remove.title = remove.disabled ? 'Remove its field mappings and stop linked on-air graphics first' : 'Remove unused connection'; actions.append(remove); top.append(actions);
    card.append(top, node('p', `${connection.settings.worksheet} · ${connection.settings.range} · Every ${connection.settings.refreshSeconds}s · Last read ${time(connection.lastSuccess)}`, 'meta'));
    if (connection.error || connection.warning) card.append(node('p', (connection.error || connection.warning) + ' · Holding last valid values.', 'warning'));
    const details = node('details'); details.append(node('summary', `${connection.usages.length} field reference${connection.usages.length === 1 ? '' : 's'}`));
    const list = node('ul'); for (const usage of connection.usages) list.append(node('li', usageText(usage))); if (!connection.usages.length) list.append(node('li', 'Ready to assign from Mappings.')); details.append(list); card.append(details); container.append(card);
  }
  if (!container.children.length) container.append(node('div', 'No connections yet. Add a public Google Sheet to get started.', 'empty'));
}
function renderLocal() {
  $('local-sources').replaceChildren();
  for (const [id, source] of Object.entries(state.sources)) if (source.type === 'local') {
    const form = node('form', undefined, 'local-value'), input = node('input'); input.value = source.value; input.maxLength = 300; input.required = true;
    const save = node('button', 'Publish test value'); save.type = 'submit'; form.append(label(source.label, input), save);
    form.onsubmit = async event => { event.preventDefault(); save.disabled = true; try { state = await request('/data/source', { id, value: input.value, revision: state.revision }); message('Test value published to committed linked fields.'); } catch (error) { message(error.message, true); } finally { save.disabled = false; } }; $('local-sources').append(form);
  }
}
function settings() { return { url: $('sheet-url').value, worksheet: sheetPicker.worksheet, range: $('sheet-range').value, refreshSeconds: Number($('sheet-refresh').value) }; }
function openConnection(id = null) {
  editingId = id; tested = ''; draftRevision = state.revision; const connection = state.connections[id];
  $('connection-form').reset(); $('sheet-label').value = connection?.label || ''; $('sheet-url').value = connection?.settings.url || ''; $('sheet-range').value = connection?.settings.range || 'A1:D4'; $('sheet-refresh').value = connection?.settings.refreshSeconds || 5;
  $('connection-title').textContent = id ? 'Edit connection' : 'Add connection'; $('sheet-preview').replaceChildren(); $('sheet-test-status').textContent = ''; $('save-sheet').disabled = true;
  $('connection-usage').textContent = connection?.usages.length ? `Used by ${connection.usages.length} field references. You can change its name or refresh interval. Add a new connection to change the sheet, tab or range.` : '';
  for (const key of ['sheet-url', 'sheet-range']) $(key).readOnly = Boolean(connection?.usages.length);
  $('connection-dialog').showModal(); sheetPicker.reset({ worksheet: connection?.settings.worksheet || '', locked: Boolean(connection?.usages.length) }); $('sheet-label').focus();
}
$('add-connection').onclick = () => openConnection(); $('close-connection').onclick = () => $('connection-dialog').close();
function invalidateSheetTest() { tested = ''; $('save-sheet').disabled = true; $('sheet-test-status').textContent = 'Test the updated settings before saving.'; }
const sheetPicker = new window.YCSSheetPicker({ request, invalidate: invalidateSheetTest });
for (const input of document.querySelectorAll('[data-setting]')) input.addEventListener('input', invalidateSheetTest);
function previewTable(data) {
  $('sheet-preview').replaceChildren(); const table = node('table'), body = node('tbody');
  for (const cells of data.slice(0, 10)) { const row = node('tr'); row.append(node('th', cells[0]?.address.match(/\d+$/)?.[0] || '')); for (const cell of cells.slice(0, 8)) { const value = node('td', cell.value); value.title = cell.address; row.append(value); } body.append(row); }
  table.append(body); $('sheet-preview').append(table, node('p', 'Preview: first 10 rows and 8 columns. Values remain read-only.', 'hint'));
}
$('test-sheet').onclick = async () => {
  const submitted = JSON.stringify(settings()); $('test-sheet').disabled = true; $('save-sheet').disabled = true; $('sheet-test-status').textContent = 'Reading public sheet…';
  try { const result = await request('/data/sheets/test', { settings: JSON.parse(submitted) }); if (submitted !== JSON.stringify(settings())) return; tested = submitted; previewTable(result.rows); $('sheet-test-status').textContent = 'Connected. Choose fields from Mappings after saving.'; $('save-sheet').disabled = false; }
  catch (error) { tested = ''; $('sheet-test-status').textContent = error.message; } finally { $('test-sheet').disabled = false; }
};
$('connection-form').onsubmit = async event => {
  event.preventDefault(); if (tested !== JSON.stringify(settings())) return; $('save-sheet').disabled = true;
  try { const result = await request('/data/connections', { id: editingId, label: $('sheet-label').value, settings: settings(), revision: draftRevision }); state = result.snapshot; $('connection-dialog').close(); renderConnections(); message('Connection saved. Assign its fields in Mappings.'); }
  catch (error) { $('sheet-test-status').textContent = error.message; $('save-sheet').disabled = false; }
};
function select(options, value) { const control = node('select'); for (const [id, title] of options) option(control, id, title); control.value = value; return control; }
function headers(connection, headerRow) { return connection?.rows.find(row => Number(row[0]?.address.match(/\d+$/)?.[0]) === Number(headerRow)) || []; }
function chooser(title, value, values) { const input = node('input'); input.value = value || ''; const list = node('datalist'); list.id = 'choices-' + (++chooser.sequence); input.setAttribute('list', list.id); for (const value of [...new Set(values.filter(Boolean))]) option(list, value, value); const result = label(title, input); result.append(list); return { result, input }; } chooser.sequence = 0;
function connectionChoices() { return [['', 'Unassigned — manual only'], ...Object.entries(state.connections).map(([id, item]) => [id, item.label]), ...Object.entries(state.sources).filter(([id, item]) => !id.startsWith('bind.') && item.type === 'local').map(([id, item]) => ['source:' + id, (item.type === 'local' ? 'Local · ' : 'Saved cell · ') + item.label])]; }
function suggestedPick(connection) {
  const headerRow = Number(connection.rows[0]?.[0]?.address.match(/\d+$/)?.[0]) || 1, columns = headers(connection, headerRow).map(cell => cell.value);
  const stageTitle = stages.find(item => item.id === $('mapping-stage').value)?.title || $('mapping-stage').value;
  const keyColumn = columns.find(value => /stage/i.test(value)) || columns[0] || '', index = columns.indexOf(keyColumn);
  const match = connection.rows.slice(1).find(row => row[index]?.value.toLowerCase() === stageTitle.toLowerCase());
  return { kind: 'row', headerRow, keyColumn, keyValue: match?.[index]?.value || stageTitle.toUpperCase(), valueColumn: columns.find(value => /round/i.test(value)) || columns[1] || columns[0] || '' };
}
function dirty(row) { row.dirty = true; $('save-mappings').disabled = false; $('mapping-status').textContent = 'Unsaved mappings · Program unchanged'; }
function renderMapping(field) {
  const article = node('article', undefined, 'mapping-field'), heading = node('div', undefined, 'field-heading');
  const scope = select([['override', 'This graphic'], ['default', 'Template default for this stage'], ['inherit', 'Use template default']], field.origin === 'default' ? 'inherit' : 'override'); scope.setAttribute('aria-label', field.title + ' mapping scope');
  heading.append(node('h3', field.title), scope); article.append(heading);
  const controls = node('div', undefined, 'mapping-controls'), sourceSelect = select(connectionChoices(), field.binding?.source ? 'source:' + field.binding.source : field.binding?.connection || '');
  sourceSelect.setAttribute('aria-label', field.title + ' source');
  const row = { field, article, controls, sourceSelect, scope, binding: structuredClone(field.binding), dirty: false, live: node('p', undefined, 'live-value') }; rows.set(field.field, row);
  function selectors() {
    controls.replaceChildren(); controls.hidden = scope.value === 'inherit'; controls.append(label('Connection / local value', sourceSelect));
    if (!sourceSelect.value || sourceSelect.value.startsWith('source:')) { row.binding = sourceSelect.value ? { source: sourceSelect.value.slice(7) } : null; paintValue(row); return; }
    const connection = state.connections[sourceSelect.value]; if (!connection) return;
    if (row.binding?.connection !== sourceSelect.value) row.binding = { connection: sourceSelect.value, selection: suggestedPick(connection) };
    const pick = row.binding.selection;
    const kind = select([['row', 'Match a row'], ['cell', 'Fixed cell']], pick.kind); controls.append(label('Select data by', kind));
    const group = node('div', undefined, 'selector-fields'); controls.append(group);
    if (pick.kind === 'cell') {
      const input = node('input'); input.value = pick.cell || ''; input.placeholder = 'A2'; group.append(label('Cell in this range', input)); input.oninput = () => { pick.cell = input.value.trim().toUpperCase(); dirty(row); paintValue(row); };
    } else {
      const header = node('input'); header.type = 'number'; header.min = 1; header.value = pick.headerRow; group.append(label('Header row', header));
      const columns = headers(connection, pick.headerRow).map(cell => cell.value), key = chooser('Key column', pick.keyColumn, columns), value = chooser('Value column', pick.valueColumn, columns), index = columns.indexOf(pick.keyColumn), match = chooser('Row key', pick.keyValue, connection.rows.slice(1).map(row => row[index]?.value));
      group.append(key.result, match.result, value.result);
      for (const [input, property] of [[header, 'headerRow'], [key.input, 'keyColumn'], [match.input, 'keyValue'], [value.input, 'valueColumn']]) input.oninput = () => { pick[property] = property === 'headerRow' ? Number(input.value) : input.value; dirty(row); paintValue(row); };
    }
    kind.onchange = () => { row.binding.selection = kind.value === 'cell' ? { kind: 'cell', cell: connection.rows[1]?.[0]?.address || connection.rows[0]?.[0]?.address || '' } : suggestedPick(connection); selectors(); dirty(row); };
    paintValue(row);
  }
  sourceSelect.onchange = () => { selectors(); dirty(row); }; scope.onchange = () => { selectors(); dirty(row); };
  article.append(controls, row.live); selectors(); return article;
}
function selectedValue(pick) {
  if (!pick) return 'Unassigned · manual text remains available';
  if (pick.source) return state.sources[pick.source]?.value || 'Waiting for a valid source value';
  const connection = state.connections[pick.connection], selection = pick.selection;
  if (!connection) return 'Connection unavailable';
  let cell;
  if (selection.kind === 'cell') cell = connection.rows.flat().find(cell => cell.address === selection.cell);
  else {
    const columns = headers(connection, selection.headerRow).map(cell => cell.value), keys = columns.filter(value => value === selection.keyColumn), values = columns.filter(value => value === selection.valueColumn);
    if (keys.length !== 1 || values.length !== 1) return 'Key or value column missing / duplicated';
    const matches = connection.rows.filter(row => Number(row[0]?.address.match(/\d+$/)?.[0]) > selection.headerRow && row[columns.indexOf(selection.keyColumn)]?.value === selection.keyValue);
    if (matches.length !== 1) return matches.length ? 'Multiple matching rows · last valid value retained' : 'No matching row · last valid value retained';
    cell = matches[0][columns.indexOf(selection.valueColumn)];
  }
  return cell?.usable ? cell.value : 'Empty or invalid selection · last valid value retained';
}
function paintValue(row) { row.live.replaceChildren(node('span', row.scope.value === 'inherit' ? 'Saved template default' : 'Source preview'), node('strong', selectedValue(row.scope.value === 'inherit' ? state.defaults.find(item => item.stage === $('mapping-stage').value && item.template === mapping.template && item.field === row.field.field)?.binding : row.binding))); }
function refreshValues() { for (const row of rows.values()) paintValue(row); }
async function loadMappings() {
  if (!$('mapping-graphic').value) { rows.clear(); $('mapping-fields').replaceChildren(node('p', 'No graphics in this stage.', 'empty')); return; }
  const result = await request(`/data/mappings/${$('mapping-stage').value}/${encodeURIComponent($('mapping-graphic').value)}`); mapping = result; rows.clear(); $('mapping-fields').replaceChildren(...result.fields.map(renderMapping)); $('save-mappings').disabled = true;
  $('mapping-context').textContent = catalog.find(item => item.id === $('mapping-graphic').value)?.title + ' · ' + result.template; $('mapping-status').textContent = 'Mappings saved · Program unchanged';
}
async function loadGraphics() { catalog = await request(`/stages/${$('mapping-stage').value}/graphics`); $('mapping-graphic').replaceChildren(); for (const item of catalog) option($('mapping-graphic'), item.id, item.title); const requested = new URLSearchParams(location.search).get('graphic'); if (catalog.some(item => item.id === requested)) $('mapping-graphic').value = requested; await loadMappings(); }
$('mapping-stage').onchange = () => loadGraphics().catch(error => message(error.message, true)); $('mapping-graphic').onchange = () => loadMappings().catch(error => message(error.message, true)); $('reload-mappings').onclick = () => loadMappings().then(() => message('Saved mappings reloaded.')).catch(error => message(error.message, true));
$('save-mappings').onclick = async () => {
  $('save-mappings').disabled = true;
  try { state = await request(`/data/mappings/${$('mapping-stage').value}/${encodeURIComponent($('mapping-graphic').value)}`, { revision: mapping.revision, edits: [...rows.values()].filter(row => row.dirty).map(row => ({ field: row.field.field, scope: row.scope.value, binding: row.binding })) }); await loadMappings(); renderConnections(); message('Mappings saved. Preview or Update / Play the graphic to use them.'); }
  catch (error) { message(error.message, true); $('save-mappings').disabled = false; }
};
async function poll() { if (loading || disposed) return; loading = true; try { state = await request('/data'); $('health').textContent = state.health === 'ok' ? 'Background sync active' : 'Data needs attention'; $('health').classList.toggle('warning', state.health !== 'ok'); if (!document.querySelector('#connections details[open]') && !document.activeElement?.closest('#connections')) renderConnections(); refreshValues(); } catch { $('health').textContent = 'Server disconnected'; $('health').classList.add('warning'); } finally { loading = false; } }
async function initialize() {
  [state, stages] = await Promise.all([request('/data'), request('/stages')]);
  for (const stage of stages) { const link = node('a', stage.title + ' rundown'); link.href = stage.controller; $('stages').append(link); option($('mapping-stage'), stage.id, stage.title); }
  const params = new URLSearchParams(location.search); if (stages.some(stage => stage.id === params.get('stage'))) $('mapping-stage').value = params.get('stage'); if (params.get('graphic')) showTab('mappings');
  renderConnections(); renderLocal(); await loadGraphics(); await poll();
}
initialize().catch(error => message(error.message, true)); const timer = setInterval(poll, 3000); window.addEventListener('pagehide', () => { disposed = true; sheetPicker.dispose(); clearInterval(timer); }, { once: true });
