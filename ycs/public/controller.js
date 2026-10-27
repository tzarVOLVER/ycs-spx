// Native SPX controls use the same stage service as Companion. Links are
// resolved on the server, with separate editor and on-air binding snapshots.
const stage = document.documentElement.dataset.ycsStage;
if (stage) {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/ycs/controller.css'; document.head.append(css);
  const panel = document.createElement('section'); panel.className = 'ycs-stage-panel';
  panel.innerHTML = `<strong class="ycs-heading"></strong><nav class="ycs-stage-links" aria-label="Stages"></nav>
    <div class="ycs-program" role="status">Reading program state…</div><div class="ycs-preview">Reading preview state…</div>
    <div class="ycs-health">Checking output connections…</div>
    <div class="ycs-actions"><button type="button" data-monitor="preview" aria-pressed="true">Preview monitor</button><button type="button" data-monitor="program" aria-pressed="false">Program monitor</button></div>
    <a class="ycs-manager-link" href="/ycs/data-manager">Data Manager</a>
    <button type="button" class="ycs-clear">STOP THIS STAGE</button><div class="ycs-command-status" role="status"></div>`;
  panel.querySelector('.ycs-heading').textContent = stage.toUpperCase().replace('-', ' ');
  document.getElementById('controllerPluginButtons')?.prepend(panel);
  const message = panel.querySelector('.ycs-command-status');
  const models = new Map(), timers = new Map();
  let sourceState, active = new Set(), program = new Map(), disposed = false, polling = false, eventsConnected = false;
  async function request(url, body) {
    const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Stage request failed');
    return payload;
  }
  function notify(text, error = false) { message.textContent = text; message.classList.toggle('ycs-error', error); }
  function fields(row) {
    return [...row.querySelectorAll('[data-update]')].map(input => ({ field: input.dataset.update, value: input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value }));
  }
  function paintLink(row, model) {
    const link = model.links?.f5, input = row.querySelector('[data-update="f5"]');
    if (!link || !input) return;
    const mapping = sourceState?.mappings.find(item => item.stage === stage && item.graphic === row.dataset.spxEpoch && item.field === 'f5');
    link.source = mapping?.source || null;
    const source = sourceState?.sources[link.source], linked = link.mode === 'linked';
    if (source?.value !== undefined) link.lastValue = source.value;
    const value = source?.value ?? link.lastValue ?? link.manual, changed = linked && input.value !== value;
    if (linked) input.value = value;
    input.readOnly = linked; input.classList.toggle('ycs-linked-input', linked);
    model.button.setAttribute('aria-pressed', String(linked));
    model.button.setAttribute('aria-label', linked ? 'Use manual Current round' : 'Link Current round to data source');
    model.button.title = linked ? 'Linked — click to restore manual text' : 'Manual — click to link';
    model.button.classList.toggle('is-linked', linked);
    const sourceProblem = !source || sourceState?.health !== 'ok' || (source.health && source.health !== 'ok') || source.warning;
    model.button.classList.toggle('is-warning', linked && Boolean(sourceProblem));
    const onAir = program.get(row.dataset.spxEpoch)?.links?.f5;
    const committed = onAir?.mode === 'linked' && onAir.source === link.source;
    model.detail.textContent = linked
      ? `${source?.label || 'Source unavailable'}${sourceProblem ? ' · source unavailable/stale; retaining last valid value' : ''} · ${committed ? 'linked on program' : 'pending until Update / Play'}`
      : `Manual${source ? ' · mapped to ' + source.label : ' · assign a source in Data Manager'}`;
    if (changed && row.classList.contains('inFocus')) schedulePreview(row);
  }
  function initialize(row) {
    const id = row.dataset.spxEpoch, model = { links: {}, revision: 0, queue: Promise.resolve() };
    models.set(id, model);
    model.ready = request(`/api/ycs/stages/${stage}/graphics/${encodeURIComponent(id)}/editor`).then(editor => {
      model.links = editor.links; model.revision = editor.revision;
      const input = row.querySelector('[data-update="f5"]');
      if (editor.links.f5 && input) {
        const container = document.createElement('div'); container.className = 'ycs-link-field'; input.before(container);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ycs-link-toggle';
        button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
        const detail = document.createElement('div'); detail.className = 'ycs-link-detail'; container.append(button, input); container.after(detail);
        model.button = button; model.detail = detail;
        button.addEventListener('click', event => {
          event.stopPropagation();
          const link = model.links.f5;
          if (link.mode === 'manual') {
            if (!link.source) { notify('Assign a source in Data Manager first.', true); return; }
            link.manual = input.value; link.mode = 'linked';
          } else { link.mode = 'manual'; input.value = link.manual; }
          row.dataset.spxChanged = 'true'; paintLink(row, model); send(row, 'preview');
        });
        input.value = editor.links.f5.manual; paintLink(row, model);
      }
    }).catch(error => { notify(error.message, true); throw error; });
    model.ready.catch(() => {});
  }
  function send(row, action) {
    if (!row) return Promise.resolve();
    const model = models.get(row.dataset.spxEpoch); if (!model) return Promise.resolve();
    clearTimeout(timers.get(row));
    const operation = model.queue.then(async () => {
      await model.ready;
      const body = ['stop', 'continue'].includes(action) ? {} : {
        fields: fields(row), links: Object.fromEntries(Object.entries(model.links).map(([field, link]) => [field, { mode: link.mode, manual: link.manual }])), revision: model.revision
      };
      const result = await request(`/api/ycs/stages/${stage}/graphics/${encodeURIComponent(row.dataset.spxEpoch)}/${action}`, body);
      if (action !== 'preview') {
        if (['play', 'update', 'save'].includes(action)) model.revision = result.editorRevision;
        notify(action === 'save' ? 'Saved. Program unchanged.' : `${row.dataset.spxEpoch}: ${action}`);
        if (['play', 'update', 'save'].includes(action)) row.dataset.spxChanged = 'false';
        if (action === 'save') {
          const summary = row.querySelector('.truncate');
          if (summary) summary.textContent = [...row.querySelectorAll('[data-update]')].filter(input => input.type !== 'hidden').slice(0, 2).map(input => input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value).join(' | ');
          if (row.querySelector('#Expanded')?.style.display !== 'none') window.ToggleExpand?.(row);
        }
      }
      return result;
    });
    model.queue = operation.catch(error => notify(error.message, true));
    return model.queue;
  }
  function schedulePreview(row) { clearTimeout(timers.get(row)); timers.set(row, setTimeout(() => send(row, 'preview'), 300)); }
  for (const row of document.querySelectorAll('.itemrow')) initialize(row);
  document.addEventListener('input', event => {
    const row = event.target.closest('.itemrow'); if (!row || !event.target.matches('[data-update]')) return;
    const model = models.get(row.dataset.spxEpoch);
    if (event.target.dataset.update === 'f5' && model?.links.f5?.mode === 'manual') model.links.f5.manual = event.target.value;
    schedulePreview(row);
  });
  // Existing buttons and keyboard shortcuts call these globals. Server state
  // drives the indicators; unsuccessful commands never mark an item on air.
  window.previewItem = row => send(row || window.getFocusedRow(), 'preview');
  window.updateItem = row => send(row || window.getFocusedRow(), 'update');
  window.saveTemplateItemChangesByElement = row => send(row, 'save');
  window.playItem = (row, forced = '', prevent = false) => {
    row ||= window.getFocusedRow(); if (!row || prevent) return;
    return send(row, forced || (active.has(row.dataset.spxEpoch) ? 'stop' : 'play'));
  };
  window.nextItem = row => send(row || window.getFocusedRow(), 'continue');
  async function clearStage() {
    try { await request(`/api/ycs/stages/${stage}/clear`, {}); notify('Stage stopped.'); }
    catch (error) { notify(error.message, true); }
  }
  window.stopAll = clearStage;
  panel.querySelector('.ycs-clear').addEventListener('click', clearStage);
  for (const button of panel.querySelectorAll('[data-monitor]')) button.addEventListener('click', () => {
    document.getElementById('previewIF').src = `/output/${stage}/${button.dataset.monitor}`;
    for (const other of panel.querySelectorAll('[data-monitor]')) other.setAttribute('aria-pressed', String(other === button));
  });
  request('/api/ycs/stages').then(stages => {
    for (const item of stages) {
      const link = document.createElement('a'); link.href = item.controller; link.textContent = item.title;
      if (item.id === stage) link.setAttribute('aria-current', 'page'); panel.querySelector('.ycs-stage-links').append(link);
    }
  }).catch(error => notify(error.message, true));
  function syncButtons(snapshot) {
    active = new Set(snapshot.graphics.map(item => item.id));
    program = new Map(snapshot.graphics.map(item => [item.id, item]));
    for (const row of document.querySelectorAll('.itemrow')) {
      const playing = active.has(row.dataset.spxEpoch); row.dataset.spxOnair = String(playing);
      const hidden = row.querySelector('[name="RundownItem[onair]"]'); if (hidden) hidden.value = String(playing);
      const icon = row.querySelector('[data-spx-name="icon"]'); icon?.classList.toggle('playTrue', playing); icon?.classList.toggle('playFalse', !playing);
      row.querySelector('[data-spx-name="updatebutton"]')?.classList.toggle('disabled', !playing);
      for (const target of row.querySelectorAll('[data-spx-name="deletesmall"], [data-spx-name="deletelarge"]')) target.style.visibility = playing ? 'hidden' : 'visible';
      const button = row.querySelector('[data-spx-name="playbutton"]');
      if (button) {
        button.textContent = button.getAttribute(playing ? 'data-spx-stoptext' : 'data-spx-playtext');
        button.classList.toggle('bg_red', playing); button.classList.toggle('bg_green', !playing);
      }
    }
    const selected = document.querySelector('.itemrow.inFocus'); if (selected) window.setMasterButtonStates?.(selected);
    panel.querySelector('.ycs-program').textContent = snapshot.graphics.length ? 'PROGRAM · ' + snapshot.graphics.map(item => item.id).join(', ') : 'PROGRAM · Stopped';
  }
  const stageEvents = io('/ycs-playback', { transports: ['websocket'], forceNew: true });
  stageEvents.on('connect', () => stageEvents.emit('subscribe', { stage, modes: ['program', 'preview'] }));
  stageEvents.on('state', snapshot => {
    if (snapshot.stage !== stage) return;
    eventsConnected = true;
    if (snapshot.mode === 'program') syncButtons(snapshot);
    else if (snapshot.mode === 'preview') panel.querySelector('.ycs-preview').textContent = snapshot.selected ? `PREVIEW · ${snapshot.selected} draft` : 'PREVIEW · Follows program';
  });
  function disconnected() {
    if (disposed) return;
    eventsConnected = false; panel.querySelector('.ycs-program').textContent = 'PROGRAM · Connection lost — state unconfirmed';
    panel.querySelector('.ycs-preview').textContent = 'PREVIEW · Reconnecting';
  }
  stageEvents.on('disconnect', disconnected); stageEvents.on('connect_error', disconnected);
  stageEvents.on('stage-error', error => notify(error.error, true));
  async function poll() {
    if (polling || disposed) return; polling = true;
    try {
      const [data, health] = await Promise.all([request('/api/ycs/data'), request(`/api/ycs/stages/${stage}/health`)]); sourceState = data;
      for (const row of document.querySelectorAll('.itemrow')) { const model = models.get(row.dataset.spxEpoch); if (model?.button) paintLink(row, model); }
      const lines = ['program', 'preview'].map(mode => {
        const state = health[mode];
        return `${mode}: ${state.errors.length ? state.errors.join('; ') : !state.connected ? 'no renderer connected' : state.ready ? `${state.ready} renderer(s) ready` : 'loading current state'}`;
      });
      const target = panel.querySelector('.ycs-health'); target.textContent = lines.join(' · ');
      target.classList.toggle('ycs-error', !eventsConnected || health.program.errors.length > 0 || (active.size > 0 && !health.program.connected));
    } catch { panel.querySelector('.ycs-health').textContent = 'Output/data status unavailable — reconnecting'; }
    finally { polling = false; }
  }
  poll(); const pollTimer = setInterval(poll, 1500);
  const options = document.getElementById('renderOptionsFoldable'); if (options) options.hidden = true;
  window.addEventListener('pagehide', () => {
    disposed = true; clearInterval(pollTimer); for (const timer of timers.values()) clearTimeout(timer);
    try { stageEvents.disconnect(); } catch { /* Transport may already be closed during navigation. */ }
  }, { once: true });
}
