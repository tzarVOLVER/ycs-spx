let documentState, stages = [];
const drafts = new Map();
const message = document.getElementById('message');
async function request(url, body) {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Data Manager request failed'); return data;
}
function notice(text, warning = false) { message.textContent = text; message.classList.toggle('warning', warning); }
function health(data) {
  const target = document.getElementById('health');
  target.textContent = data.health === 'ok' ? 'Local JSON source connected' : data.error;
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
function render() {
  health(documentState);
  const sources = document.getElementById('sources'); sources.replaceChildren();
  for (const [id, source] of Object.entries(documentState.sources)) {
    const form = controls(source.label, source.value, `source-${id}`, (value, revision) => request('/api/ycs/data/source', { id, value, revision }));
    const key = document.createElement('small'); key.textContent = id; form.append(key); sources.append(form);
  }
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
document.getElementById('reload').addEventListener('click', () => { drafts.clear(); load().then(() => notice('Saved data reloaded.')).catch(error => notice(error.message, true)); });
load().catch(error => notice(error.message, true));
// Only health is polled: external revisions must not silently overwrite an
// operator's unsaved source edits. Saves reject a stale document revision.
let polling = false;
const timer = setInterval(async () => {
  if (polling) return; polling = true;
  try { health(await request('/api/ycs/data')); }
  catch { document.getElementById('health').textContent = 'Data service disconnected — saved edits are retained'; }
  finally { polling = false; }
}, 2000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
