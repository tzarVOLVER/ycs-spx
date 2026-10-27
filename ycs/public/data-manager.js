let documentState, stages = [];
const drafts = new Map(), remoteCards = new Map();
const message = document.getElementById('message');
async function request(url, body) {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Data Manager request failed'); return data;
}
function notice(text, warning = false) { message.textContent = text; message.classList.toggle('warning', warning); }
function health(data) {
  const target = document.getElementById('health');
  const count = Object.values(data.sources).filter(source => source.type === 'google-sheets').length;
  target.textContent = data.health === 'ok' ? `Source configuration connected · ${count} Google Sheets source(s)` : data.error;
  target.classList.toggle('warning', data.health !== 'ok');
}
function controls(label, value, key, submit, options) {
  const form = document.createElement('form'); form.className = options ? 'mapping' : 'source';
  const caption = document.createElement('label'); caption.textContent = label;
  const input = document.createElement(options ? 'select' : 'input'); input.id = key; caption.htmlFor = key;
  if (options) for (const [id, source] of Object.entries(options)) {
    const option = document.createElement('option'); option.value = id; option.textContent = source.label; input.append(option);
  }
  else { input.type = 'text'; input.maxLength = 300; input.required = true; }
  input.value = drafts.get(key) ?? value;
  input.addEventListener('input', () => drafts.set(key, input.value));
  const line = document.createElement('div'); line.className = 'controls';
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = options ? 'Save mapping' : 'Publish source';
  line.append(input, button); form.append(caption, line);
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true;
    try {
      const next = await submit(input.value, documentState.revision);
      drafts.delete(key); documentState = next; render();
      notice(options ? 'Mapping saved. Apply it to program with Play or Update in the rundown.' : 'Source published. Committed linked fields follow it automatically.');
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
  return form;
}
function sourceStatus(source) {
  const last = source.lastSuccess ? new Date(source.lastSuccess).toLocaleString() : 'Not yet';
  const state = source.health === 'ok' ? 'Connected' : source.health === 'loading' ? 'Connecting; using the saved value if available' : `${source.error || 'Source stale/unavailable'} · keeping the last valid value`;
  return `${state} · Last success: ${last}${source.health !== 'ok' && source.nextRefresh ? ' · Retry: ' + new Date(source.nextRefresh).toLocaleTimeString() : ''}${source.warning ? ' · ' + source.warning : ''}`;
}
function updateRemoteCards(data) {
  for (const [id, nodes] of remoteCards) {
    const source = data.sources[id];
    if (!source) { nodes.status.textContent = 'Source changed elsewhere. Reload saved data.'; nodes.status.classList.add('warning'); continue; }
    nodes.value.textContent = source.value ?? 'Waiting for the first valid value';
    nodes.status.textContent = sourceStatus(source);
    nodes.status.classList.toggle('warning', source.health !== 'ok' || Boolean(source.warning));
  }
}
function remoteCard(id, source) {
  const card = document.createElement('div'); card.className = 'source remote-source';
  const title = document.createElement('strong'); title.textContent = source.label;
  const value = document.createElement('output'); value.className = 'remote-value'; value.setAttribute('aria-label', `${source.label} live value`);
  const status = document.createElement('p'); status.className = 'source-status'; status.setAttribute('role', 'status');
  const details = document.createElement('small'); details.textContent = `Google Sheets · tab ${source.settings.worksheet} · ${source.settings.cell} · every ${source.settings.refreshSeconds}s`;
  const link = document.createElement('a'); link.href = source.settings.url + (/^\d+$/.test(source.settings.worksheet) ? '#gid=' + source.settings.worksheet : ''); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open spreadsheet';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh now';
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    try {
      const next = await request(`/api/ycs/data/sheets/${encodeURIComponent(id)}/refresh`, {}); updateRemoteCards(next);
      notice(next.sources[id]?.health === 'ok' ? 'Sheet refreshed.' : next.sources[id]?.error || 'Sheet unavailable; retaining the last valid value.', next.sources[id]?.health !== 'ok');
    } catch (error) { notice(error.message, true); }
    finally { refresh.disabled = false; }
  });
  const actions = document.createElement('div'); actions.className = 'source-actions'; actions.append(link, refresh);
  card.append(title, value, details, status, actions); remoteCards.set(id, { value, status }); return card;
}
function render() {
  health(documentState); remoteCards.clear();
  const sources = document.getElementById('sources'); sources.replaceChildren();
  for (const [id, source] of Object.entries(documentState.sources)) {
    if (source.type === 'google-sheets') sources.append(remoteCard(id, source));
    else {
      const form = controls(source.label, source.value, `source-${id}`, (value, revision) => request('/api/ycs/data/source', { id, value, revision }));
      const key = document.createElement('small'); key.textContent = id; form.append(key); sources.append(form);
    }
  }
  updateRemoteCards(documentState);
  const mappings = document.getElementById('mappings'); mappings.replaceChildren();
  for (const stage of stages) {
    const mapping = documentState.mappings.find(item => item.stage === stage.id && item.graphic === 'ticker' && item.field === 'f5');
    mappings.append(controls(`${stage.title} / Ticker / Current round`, mapping?.source || '', `mapping-${stage.id}`,
      (source, revision) => request('/api/ycs/data/mapping', { stage: stage.id, graphic: 'ticker', field: 'f5', source, revision }), documentState.sources));
  }
}
async function load() {
  [documentState, stages] = await Promise.all([request('/api/ycs/data'), request('/api/ycs/stages')]);
  const links = document.getElementById('stages'); links.replaceChildren();
  for (const stage of stages) { const link = document.createElement('a'); link.href = stage.controller; link.textContent = `${stage.title} rundown`; links.append(link); }
  render();
}

const addForm = document.getElementById('add-sheet'), testButton = document.getElementById('test-sheet'), saveButton = document.getElementById('save-sheet');
const testStatus = document.getElementById('sheet-test-status'), selectedText = document.getElementById('selected-cell'), preview = document.getElementById('sheet-preview');
let tested, selected, generation = 0;
function settings() {
  return { url: document.getElementById('sheet-url').value, worksheet: document.getElementById('sheet-worksheet').value,
    range: document.getElementById('sheet-range').value, refreshSeconds: Number(document.getElementById('sheet-refresh').value) };
}
function invalidate() {
  generation++; tested = null; selected = null; saveButton.disabled = true; preview.replaceChildren();
  selectedText.textContent = 'Test the connection, then choose a cell to use as the source value.'; testStatus.textContent = '';
}
for (const input of addForm.querySelectorAll('[data-sheet-setting]')) input.addEventListener('input', invalidate);
testButton.addEventListener('click', async () => {
  if (!addForm.reportValidity()) return;
  invalidate(); const attempt = generation, input = settings(), signature = JSON.stringify(input);
  testButton.disabled = true; testStatus.textContent = 'Reading public sheet…';
  try {
    const result = await request('/api/ycs/data/sheets/test', { settings: input });
    if (generation !== attempt || signature !== JSON.stringify(settings())) return;
    tested = { signature, settings: result.settings };
    testStatus.textContent = 'Connected. Choose a nonempty cell below.'; testStatus.classList.remove('warning');
    const table = document.createElement('table'); table.setAttribute('aria-label', 'Google Sheets preview');
    for (const cells of result.rows) {
      const row = document.createElement('tr');
      for (const cell of cells) {
        const td = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.className = 'sheet-cell'; button.disabled = !cell.usable;
        const address = document.createElement('small'); address.textContent = cell.address;
        const value = document.createElement('span'); value.textContent = cell.value || '—'; button.append(address, value);
        button.title = cell.usable ? `Use ${cell.address}` : 'Choose a nonempty value of up to 300 characters';
        button.addEventListener('click', () => {
          selected = cell.address; saveButton.disabled = false;
          for (const other of table.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
          selectedText.textContent = `${cell.address} → ${cell.value}`;
        });
        td.append(button); row.append(td);
      }
      table.append(row);
    }
    preview.append(table);
  } catch (error) { if (generation === attempt) { testStatus.textContent = error.message; testStatus.classList.add('warning'); } }
  finally { testButton.disabled = false; }
});
addForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!tested || !selected || tested.signature !== JSON.stringify(settings()) || !documentState) { notice('Test the connection and choose a cell first.', true); return; }
  saveButton.disabled = true;
  try {
    const result = await request('/api/ycs/data/sheets', { label: document.getElementById('sheet-label').value,
      settings: { ...tested.settings, cell: selected }, revision: documentState.revision });
    documentState = result.snapshot; render(); invalidate();
    notice('Google Sheets source added. Assign it under Field mappings, then use the chain in the rundown. Program is unchanged.');
  } catch (error) { notice(error.message, true); saveButton.disabled = false; }
});
document.getElementById('reload').addEventListener('click', () => { drafts.clear(); load().then(() => notice('Saved data reloaded.')).catch(error => notice(error.message, true)); });
load().catch(error => notice(error.message, true));
// Live values/status refresh independently of the saved configuration revision,
// so polling cannot overwrite a manual input or silently accept a stale save.
let polling = false;
const timer = setInterval(async () => {
  if (polling) return; polling = true;
  try { const latest = await request('/api/ycs/data'); health(latest); updateRemoteCards(latest); }
  catch { document.getElementById('health').textContent = 'Data service disconnected — saved edits are retained'; }
  finally { polling = false; }
}, 2000);
window.addEventListener('pagehide', () => { generation++; clearInterval(timer); }, { once: true });
