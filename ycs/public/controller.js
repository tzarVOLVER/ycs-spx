// Use the existing SPX rundown editor; only add stage context and pending preview.
const stage = document.documentElement.dataset.ycsStage;
if (stage) {
  const pluginArea = document.getElementById('controllerPluginButtons');
  const panel = document.createElement('div');
  panel.className = 'ycs-stage-panel';
  panel.style.cssText = 'padding:12px;background:#26343f;color:#e2eaf0;font:13px sans-serif;line-height:1.6';
  const title = document.createElement('strong');
  title.textContent = stage.toUpperCase() + ' · PREVIEW';
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  const links = document.createElement('div');
  panel.append(title, status, links);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn wide bg_red';
  clear.textContent = 'STOP THIS STAGE';
  clear.addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/ycs/stages/${stage}/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Stage clear failed');
    } catch (error) { status.textContent = error.message; }
  });
  panel.append(clear);
  pluginArea?.prepend(panel);
  const style = document.createElement('style');
  style.textContent = '#controllerPluginButtons > :not(.ycs-stage-panel){display:none!important}';
  document.head.append(style);
  fetch('/api/ycs/stages').then(response => response.json()).then(stages => {
    for (const item of stages) {
      const link = document.createElement('a');
      link.href = item.controller;
      link.textContent = item.title;
      link.style.cssText = 'color:#f0cc55;margin-right:14px';
      links.append(link);
    }
  }).catch(() => { status.textContent = 'Could not read stage list'; });

  const events = new EventSource(`/api/ycs/stages/${stage}/program/events`);
  events.addEventListener('state', event => {
    const snapshot = JSON.parse(event.data);
    const active = new Set(snapshot.graphics.map(item => item.id));
    document.querySelectorAll('.itemrow').forEach(row => {
      const playing = active.has(row.dataset.spxEpoch);
      row.dataset.spxOnair = String(playing);
      const hidden = row.querySelector('[name="RundownItem[onair]"]');
      if (hidden) hidden.value = String(playing);
      const icon = row.querySelector('[data-spx-name="icon"]');
      icon?.classList.toggle('playTrue', playing);
      icon?.classList.toggle('playFalse', !playing);
      const button = row.querySelector('[data-spx-name="playbutton"]');
      if (button) {
        button.textContent = button.getAttribute(playing ? 'data-spx-stoptext' : 'data-spx-playtext');
        button.classList.toggle('bg_red', playing);
        button.classList.toggle('bg_green', !playing);
      }
    });
    const selected = document.querySelector('.itemrow.inFocus');
    if (selected) window.setMasterButtonStates?.(selected);
    status.textContent = snapshot.graphics.length ? 'Active: ' + snapshot.graphics.map(item => item.id).join(', ') : 'Program stopped';
  });
  events.onerror = () => { status.textContent = 'Reconnecting to stage playback'; };

  let previewTimer;
  document.addEventListener('input', event => {
    const row = event.target.closest('.itemrow');
    if (!row || !event.target.matches('[data-update]')) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const fields = [...row.querySelectorAll('[data-update]')].map(input => ({ field: input.dataset.update, value: input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value }));
      try {
        const response = await fetch(`/api/ycs/stages/${stage}/graphics/${encodeURIComponent(row.dataset.spxEpoch)}/preview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields })
        });
        if (!response.ok) throw new Error('Preview update failed');
      } catch (error) { status.textContent = error.message; }
    }, 300);
  });
  // Legacy popup options point at the shared renderer; the stage's preview is
  // already embedded. Do not offer those controls in the stage pilot.
  const options = document.getElementById('renderOptionsFoldable');
  if (options) options.hidden = true;
  window.addEventListener('pagehide', () => { clearTimeout(previewTimer); events.close(); }, { once: true });
}
