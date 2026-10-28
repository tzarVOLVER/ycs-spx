// Native SPX controls use the same stage service as Companion. Links are
// resolved on the server, with separate editor and on-air binding snapshots.
const stage = document.documentElement.dataset.ycsStage;
if (stage) {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/ycs/controller.css'; document.head.append(css);
  const panel = document.createElement('section'); panel.className = 'ycs-stage-panel';
  panel.innerHTML = `<div class="ycs-panel-heading"><strong class="ycs-heading"></strong><nav class="ycs-stage-links" aria-label="Stages"></nav></div>
    <div class="ycs-program" role="status">Reading program state…</div>
    <div class="ycs-actions"><button type="button" data-monitor="preview" aria-pressed="true">Preview</button><button type="button" data-monitor="program" aria-pressed="false">Program</button><a class="ycs-manager-link" href="/ycs/data-manager">Data Manager ↗</a></div>
    <details class="ycs-output-details"><summary>Output connections</summary><div class="ycs-preview">Reading preview state…</div><div class="ycs-health">Checking connections…</div></details>
    <button type="button" class="ycs-clear">Stop stage</button><div class="ycs-command-status" role="status"></div>`;
  panel.querySelector('.ycs-heading').textContent = stage.toUpperCase().replace('-', ' ');
  document.getElementById('controllerPluginButtons')?.prepend(panel);
  const message = panel.querySelector('.ycs-command-status');
  const models = new Map(), timers = new Map();
  let validationRow;
  const iconMarkup=name=>`<svg class="ycs-editor-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="/ycs/editor-icons.svg#${name}"></use></svg>`;
  let sourceState, active = new Set(), program = new Map(), disposed = false, polling = false, eventsConnected = false;
  async function request(url, body) {
    const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || 'Stage request failed'); error.fields = payload.fields; throw error; }
    return payload;
  }
  function notify(text, error = false) { message.textContent = text; message.classList.toggle('ycs-error', error); }
  function fieldErrors(row, errors = {}) {
    for (const input of row.querySelectorAll('[data-update]')) {
      const id = `ycs-error-${row.dataset.spxEpoch}-${input.dataset.update}`;
      row.querySelectorAll('.ycs-field-error').forEach(element => { if (element.id === id) element.remove(); });
      const descriptions = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
      input.removeAttribute('aria-invalid');
      if (errors[input.dataset.update]) {
        const detail = document.createElement('small'); detail.id = id; detail.className = 'ycs-field-error'; detail.textContent = errors[input.dataset.update]; detail.setAttribute('role', 'status');
        (input.closest('.ycs-link-field') || input).after(detail);
        input.setAttribute('aria-invalid', 'true'); descriptions.push(id);
      }
      if (descriptions.length) input.setAttribute('aria-describedby', descriptions.join(' ')); else input.removeAttribute('aria-describedby');
    }
  }
  function fields(row) {
    return [...row.querySelectorAll('[data-update]')].map(input => ({ field: input.dataset.update, value: input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value }));
  }
  function pending(row, model) {
    if (!model.badge) return;
    let changed = row.dataset.spxChanged === 'true';
    const current = program.get(row.dataset.spxEpoch);
    if (current) for (const [field, link] of Object.entries(model.links)) {
      if (link.mode === 'linked' ? current.links?.[field]?.source !== link.source || current.links?.[field]?.mode !== link.mode : current.data?.[field] !== link.manual) changed = true;
    }
    model.badge.hidden = !changed; model.badge.textContent = current ? 'Pending · Update on air to apply' : 'Unsaved draft';
  }
  function editorValue(input,value) {
    const text=String(value);
    if(input.type==='checkbox'){if(['1','true','yes','on'].includes(text.toLowerCase()))return '1';if(['0','false','no','off'].includes(text.toLowerCase()))return '0';throw new Error('Expected a boolean');}
    if(input.type==='number'){if(!text.trim()||!Number.isFinite(Number(text)))throw new Error('Expected a number');return String(Number(text));}
    return text;
  }
  function showValue(input,value){if(input.type==='checkbox')input.checked=String(value)==='1';else{if(input.tagName==='SELECT'&&![...input.options].some(option=>option.value===String(value))){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);option.dataset.ycsValue='true';input.append(option);}input.value=value;}}
  function manualValue(input){return input.type==='checkbox'?(input.checked?'1':'0'):input.value;}
  function paintLink(row, model) {
    for (const [field, widget] of Object.entries(model.widgets || {})) {
      const link = model.links[field], { input, button, detail, title } = widget;
      const override = sourceState?.mappings.find(item => item.stage === stage && item.graphic === row.dataset.spxEpoch && item.field === field);
      const fallback = sourceState?.defaults?.find(item => item.stage === stage && item.template === model.template && item.field === field);
      if (sourceState) {
        const nextSource = (override || fallback)?.source || null;
        if (link.source !== nextSource) delete link.lastValue;
        link.source = nextSource;
      }
      const source = sourceState?.sources[link.source], linked = link.mode === 'linked';
      let incompatible=false;
      if(source?.value!==undefined){try{link.lastValue=editorValue(input,source.value);}catch{incompatible=true;}}
      const value = link.lastValue ?? link.manual, changed = linked && manualValue(input) !== value;
      if (linked) showValue(input,value);
      input.readOnly = linked; if(input.type==='checkbox'||input.tagName==='SELECT')input.disabled=linked; input.classList.toggle('ycs-linked-input', linked);
      button.setAttribute('aria-pressed', String(linked)); button.setAttribute('aria-label', linked ? 'Use manual ' + title : 'Link ' + title + ' to data source');
      button.classList.toggle('is-linked', linked);button.classList.toggle('is-unassigned',!link.source);
      button.querySelector('use')?.setAttribute('href','/ycs/editor-icons.svg#'+(linked?'link-2':'unlink-2'));
      const problem = incompatible || !source || sourceState?.health !== 'ok' || (source.health && source.health !== 'ok') || source.warning;
      button.classList.toggle('is-warning', linked && Boolean(problem));
      let description=linked ? `${source?.label || 'Source unavailable'}${problem ? ' · holding last valid value / manual fallback' : ''}` : link.source ? 'Manual override · ' + (source?.label||'unavailable source') : 'Manual · source unassigned';
      if(source?.collection)description+=` · ${source.collection.included} stories, ${source.collection.excluded} unpublished${source.collection.invalid?', '+source.collection.invalid+' invalid':''}`;
      if(linked&&problem&&source?.error)description+=' · '+source.error;
      button.title=description+' · '+(linked?'Click to restore manual value':link.source?'Click to link':'Assign a source in Manage field mappings');input.title=title+' · '+description;
      detail.textContent=linked&&problem?'Holding last valid value / manual fallback':description;detail.classList.toggle('is-warning',linked&&Boolean(problem));
      if (changed && row.classList.contains('inFocus')) schedulePreview(row);
    }
    pending(row, model);
  }
  function organize(row, editor, model) {
    const cell = row.querySelector('#Expanded td[width="65%"]');
    const supported = ['hidden', 'textfield', 'checkbox', 'number', 'filelist', 'textarea', 'dropdown', 'caption', 'instruction', 'spacer'];
    if (!cell || !editor.fields?.length || editor.fields.some(field => !supported.includes(field.ftype))) return;
    const original = document.createElement('div'); original.hidden = true; original.className = 'ycs-original-fields';
    while (cell.firstChild) original.append(cell.firstChild); cell.append(original);
    cell.classList.add('ycs-compact-editor');
    const content = document.createElement('div'); content.className = 'ycs-editor-content';
    const heading=document.createElement('div');heading.className='ycs-editor-heading';const headingTitle=document.createElement('div');headingTitle.className='ycs-editor-title';
    const nativeTitle=row.querySelector('#Expanded td[colspan="3"].spxTableHeadsmall');
    if(nativeTitle){while(nativeTitle.firstChild)headingTitle.append(nativeTitle.firstChild);nativeTitle.closest('tr').hidden=true;}else headingTitle.textContent=editor.title||row.dataset.spxEpoch;
    for(const icon of headingTitle.querySelectorAll('.l-icon')){
      // Font Awesome observes its generated SVG nodes. A fresh wrapper prevents
      // it from replacing the local Lucide icon after a class/path change.
      const replacement=document.createElement('span');replacement.className='l-icon ycs-template-edit';
      for(const name of ['disabled','HIDE','hide','hidden'])if(icon.classList.contains(name))replacement.classList.add(name);
      replacement.hidden=icon.hidden;replacement.style.cssText=icon.style.cssText;
      for(const name of ['onclick','onmouseover','onmouseout'])if(icon.hasAttribute(name))replacement.setAttribute(name,icon.getAttribute(name));
      replacement.innerHTML=iconMarkup('square-pen');replacement.title=icon.classList.contains('disabled')?'Template folder access is disabled':'Open template folder';icon.replaceWith(replacement);
    }
    const toggles=document.createElement('div');toggles.className='ycs-editor-toggles';heading.append(headingTitle,toggles);content.append(heading);
    const advanced = document.createElement('details'); advanced.className = 'ycs-advanced'; advanced.innerHTML = '<summary>Appearance & timing</summary>';
    const badge = document.createElement('span'); badge.className = 'ycs-pending'; badge.hidden = true; model.badge = badge;
    const manager = document.createElement('a'); manager.href = `/ycs/data-manager?stage=${stage}&graphic=${encodeURIComponent(row.dataset.spxEpoch)}`; manager.className = 'ycs-field-mappings'; manager.textContent = 'Manage field mappings ↗';
    cell.append(content, advanced, manager, badge);
    for (const field of editor.fields) {
      const input = original.querySelector(`[data-update="${field.field}"]`); if (!input || field.ftype === 'hidden') continue;
      const wrapper = document.createElement('div'); wrapper.className = 'ycs-editor-field';
      const label = document.createElement('label'); input.id ||= `ycs-${row.dataset.spxEpoch}-${field.field}`; label.htmlFor = input.id; label.textContent = field.title==='Rounds remaining text'?'Remaining text':field.title || field.field;
      if (field.ftype === 'checkbox') { input.classList.add('ycs-check');wrapper.classList.add('ycs-checkbox-field');wrapper.append(input, label);toggles.append(wrapper);continue; }
      else wrapper.append(label, input);
      if(field.ycsCollection){const group=document.createElement('details');group.className='ycs-advanced';const summary=document.createElement('summary');summary.textContent=field.title||'Stories';summary.title='Manual JSON fallback. Link this field to use its mapped story list.';group.append(summary,wrapper);content.append(group);}else (['number', 'filelist', 'textarea'].includes(field.ftype) ? advanced : content).append(wrapper);
    }
    if (advanced.children.length === 1) advanced.hidden = true;
    for (const info of row.querySelectorAll('#Expanded td.aright.spxTableHeadsmall')) info.closest('tr').hidden = true;
    const save = row.querySelector('button[onclick*="saveTemplateItemChangesByElement"]'); if (save) { save.textContent = 'Save draft'; save.title = 'Save without changing program'; }
    const update = row.querySelector('[data-spx-name="updatebutton"]'); if (update) { update.textContent = 'Update on air'; update.title = 'Apply this draft and its field links to program'; }
    const siblingCells=[...cell.parentElement.children].filter(sibling=>sibling!==cell),nativeActions=siblingCells.flatMap(sibling=>[...sibling.querySelectorAll('button,.l-icon')]);
    if(nativeActions.length){const footer=document.createElement('div');footer.className='ycs-editor-footer';const actions=document.createElement('div');actions.className='ycs-editor-actions';const tools=document.createElement('div');tools.className='ycs-editor-tools';for(const action of nativeActions)(action.tagName==='BUTTON'?actions:tools).append(action);footer.append(manager,actions,tools);cell.append(footer);for(const sibling of siblingCells)sibling.hidden=true;cell.colSpan=siblingCells.length+1;cell.setAttribute('width','100%');}
  }
  function initialize(row) {
    const id = row.dataset.spxEpoch, model = { links: {}, widgets: {}, revision: 0, queue: Promise.resolve() }; models.set(id, model);
    model.ready = request(`/api/ycs/stages/${stage}/graphics/${encodeURIComponent(id)}/editor`).then(editor => {
      model.links = editor.links; model.revision = editor.revision; model.template = editor.template; organize(row, editor, model);
      for (const [field, link] of Object.entries(model.links)) {
        const input = row.querySelector(`[data-update="${field}"]`); if (!input) continue;
        const title = editor.fields?.find(item => item.field === field)?.title || input.placeholder || 'Current round';
        const container = document.createElement('div'); container.className = 'ycs-link-field'; input.before(container);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ycs-link-toggle';
        button.innerHTML = iconMarkup('unlink-2');
        const detail = document.createElement('div'); detail.className = 'ycs-link-detail';detail.id=`ycs-link-${id}-${field}`;input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),detail.id].filter(Boolean).join(' '));button.setAttribute('aria-describedby',detail.id);container.append(button, input); container.after(detail);
        model.widgets[field] = { input, button, detail, title };
        button.addEventListener('click', event => {
          event.stopPropagation();
          if (link.mode === 'manual') { if (!link.source) { notify('Assign a source using Manage field mappings first.', true); return; } link.manual = manualValue(input); link.mode = 'linked'; }
          else { link.mode = 'manual'; showValue(input,link.manual); }
          row.dataset.spxChanged = 'true'; paintLink(row, model); send(row, 'preview');
        }); showValue(input,link.manual);
      }
      paintLink(row, model);
    }).catch(error => { notify(error.message, true); throw error; }); model.ready.catch(() => {});
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
      if (!['stop', 'continue'].includes(action)) fieldErrors(row);
      if (validationRow === row && !['stop', 'continue'].includes(action)) { notify(''); validationRow = null; }
      if (action !== 'preview') {
        if (['play', 'update', 'save'].includes(action)) model.revision = result.editorRevision;
        notify(action === 'save' ? 'Saved. Program unchanged.' : `${row.dataset.spxEpoch}: ${action}`);
        if (['play', 'update', 'save'].includes(action)) { row.dataset.spxChanged = 'false'; pending(row, model); }
        if (action === 'save') {
          const summary = row.querySelector('.truncate');
          if (summary) summary.textContent = [...row.querySelectorAll('[data-update]')].filter(input => input.type !== 'hidden').slice(0, 2).map(input => input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value).join(' | ');
          if (row.querySelector('#Expanded')?.style.display !== 'none') window.ToggleExpand?.(row);
        }
      }
      return result;
    });
    model.queue = operation.catch(error => { validationRow = error.fields ? row : null; fieldErrors(row, error.fields); notify(error.message, true); });
    return model.queue;
  }
  function schedulePreview(row) { clearTimeout(timers.get(row)); timers.set(row, setTimeout(() => send(row, 'preview'), 300)); }
  for (const row of document.querySelectorAll('.itemrow')) initialize(row);
  document.addEventListener('input', event => {
    const row = event.target.closest('.itemrow'); if (!row || !event.target.matches('[data-update]')) return;
    const model = models.get(row.dataset.spxEpoch);
    const link = model?.links[event.target.dataset.update];
    if (link?.mode === 'manual') link.manual = manualValue(event.target);
    row.dataset.spxChanged = 'true'; if (model) pending(row, model);
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
    panel.querySelector('.ycs-program').textContent = snapshot.graphics.length ? 'PROGRAM · ' + snapshot.graphics.length + ' active · ' + snapshot.graphics.map(item => item.slot).join(', ') : 'PROGRAM · Stopped';
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
      for (const row of document.querySelectorAll('.itemrow')) { const model = models.get(row.dataset.spxEpoch); if (model?.widgets) paintLink(row, model); }
      const lines = ['program', 'preview'].map(mode => {
        const state = health[mode];
        return `${mode}: ${state.errors.length ? state.errors.join('; ') : !state.connected ? 'no renderer connected' : state.ready ? `${state.ready} renderer(s) ready` : 'loading current state'}`;
      });
      const target = panel.querySelector('.ycs-health'); target.textContent = lines.join(' · ');
      const problem = !eventsConnected || health.program.errors.length > 0 || (active.size > 0 && !health.program.connected);
      target.classList.toggle('ycs-error', problem);
      panel.querySelector('.ycs-output-details summary').textContent = problem ? 'Output connections · Needs attention' : 'Output connections';
      panel.querySelector('.ycs-output-details summary').classList.toggle('ycs-error', problem);
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
