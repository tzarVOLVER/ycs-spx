// Builds copy controls only. No button in this disclosure sends playout.
window.YCSCompanionTools = function ({ row, stage, editor, copyText }) {
  const target = row.querySelector('.ycs-compact-editor') || row.querySelector('#Expanded');
  if (!target || row.querySelector('.ycs-companion-tools')) return;
  const item = row.dataset.spxEpoch;
  const details = document.createElement('details');
  details.className = 'ycs-companion-tools';
  const summary = document.createElement('summary');
  summary.textContent = 'Companion controls';
  const identity = document.createElement('div');
  identity.className = 'ycs-companion-identity';
  const id = document.createElement('code');
  id.textContent = 'Item ID: ' + item;
  const copyID = document.createElement('button');
  copyID.type = 'button';
  copyID.textContent = 'Copy ID';
  const buttons = document.createElement('div');
  buttons.className = 'ycs-companion-actions';
  const status = document.createElement('div');
  status.className = 'ycs-copy-status';
  status.setAttribute('role', 'status');
  const fallback = document.createElement('input');
  fallback.className = 'ycs-copy-fallback';
  fallback.readOnly = true;
  fallback.hidden = true;
  fallback.setAttribute('aria-label', 'Companion command to copy');
  copyID.addEventListener('click', () => copyText(item, 'Item ID', { status, fallback }));
  identity.append(id, copyID);
  const help = document.createElement('p');
  help.textContent =
    'Generic HTTP · POST · Content type application/json · Body {} · Press action only';
  const note = document.createElement('p');
  note.textContent =
    'Commands use saved fields. Copying does not play or update graphics. Recreate buttons if you delete and re-add this item.';
  for (const action of window.YCSCompanion.actions) {
    const title = action[0].toUpperCase() + action.slice(1);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy ' + title + ' URL';
    button.disabled = editor.slotConfigured === false;
    const url = new URL(window.YCSCompanion.command(stage, item, action).path, location.href).href;
    button.title = 'POST ' + url;
    button.addEventListener('click', () => copyText(url, title + ' URL', { status, fallback }));
    buttons.append(button);
  }
  details.append(summary, identity, buttons, help, note, status, fallback);
  for (const type of ['click', 'keydown', 'keyup'])
    details.addEventListener(type, (event) => event.stopPropagation());
  if (editor.slotConfigured === false) {
    const warning = document.createElement('p');
    warning.className = 'ycs-error';
    warning.textContent =
      'This item has no configured output slot. Companion commands cannot play it until a slot is assigned.';
    details.append(warning);
  }
  // Prevent SPX's global shortcuts from firing while selecting fallback text.
  fallback.addEventListener('keydown', (event) => event.stopPropagation());
  fallback.addEventListener('keyup', (event) => event.stopPropagation());
  target.append(details);
};
