// Browses the SPX server. Use file edits the connection draft; it never saves or sends playout.
window.YCSLocalFilePicker = class LocalFilePicker {
  constructor({ request, invalidate, getType }) {
    Object.assign(this, { request, invalidate, getType });
    this.$ = (id) => document.getElementById(id);
    this.sequence = 0;
    this.session = 0;
    this.browseSequence = 0;
    this.locations = [];
    this.entries = [];
    this.$('refresh-local-files').onclick = () => this.open();
    this.$('local-file').oninput = () => this.invalidate();
    this.$('local-location').onchange = () => {
      this.$('local-file').value = '';
      this.describe();
      this.invalidate();
    };
    this.$('csv-delimiter').onchange = () => this.invalidate();
    this.parentClosed = () => {
      this.sequence++;
      this.session++;
      if (this.$('file-browser-dialog').open) this.$('file-browser-dialog').close();
    };
    this.browserClosed = () => {
      this.browseSequence++;
      this.clearSelection();
    };
    this.$('connection-dialog').addEventListener('close', this.parentClosed);
    this.$('file-browser-dialog').addEventListener('close', this.browserClosed);
    for (const id of ['close-file-browser', 'cancel-file-browser'])
      this.$(id).onclick = () => this.$('file-browser-dialog').close();
    this.$('file-browser-location').onchange = () => this.browse('');
    this.$('file-browser-go').onclick = () => this.browse(this.$('file-browser-directory').value);
    this.$('file-browser-directory').onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.browse(event.target.value);
      }
    };
    this.$('file-browser-up').onclick = () =>
      this.browse(this.directory.split('/').slice(0, -1).join('/'));
    this.$('file-browser-refresh').onclick = () => this.browse(this.directory);
    this.$('file-browser-search').oninput = () => this.renderEntries();
    this.$('use-server-file').onclick = () => this.apply();
  }
  reset({ file = '', location = 'default', locked = false } = {}) {
    this.sequence++;
    this.session++;
    this.browseSequence++;
    this.locked = locked;
    this.$('local-file').value = file;
    this.setOptions(this.$('local-location'), location);
    if (window.YCSSourceTypes.isLocal(this.getType())) return this.load();
  }
  setOptions(select, selected) {
    select.replaceChildren();
    const locations = this.locations.length
      ? [...this.locations]
      : [{ id: 'default', label: 'Local data' }];
    if (!locations.some((location) => location.id === selected))
      locations.push({ id: selected, label: selected + ' (not configured)' });
    for (const location of locations) {
      const option = document.createElement('option');
      option.value = location.id;
      option.textContent = location.label;
      select.append(option);
    }
    select.value = selected;
  }
  describe() {
    const location = this.locations.find((item) => item.id === this.$('local-location').value);
    this.$('local-file-status').textContent = location
      ? 'SPX server location: ' + location.path
      : 'Location unavailable. Check the server configuration.';
  }
  async load() {
    const type = this.getType();
    if (!window.YCSSourceTypes.isLocal(type)) return;
    const sequence = ++this.sequence;
    this.$('local-file-status').textContent = 'Loading server locations…';
    try {
      const result = await this.request('/data/local/locations');
      if (
        sequence !== this.sequence ||
        type !== this.getType() ||
        !this.$('connection-dialog').open
      )
        return;
      this.locations = result.locations;
      this.setOptions(this.$('local-location'), this.$('local-location').value || 'default');
      this.$('local-location').disabled = this.locked;
      this.describe();
    } catch (error) {
      if (sequence === this.sequence) this.$('local-file-status').textContent = error.message;
    }
  }
  async open() {
    if (this.locked) return;
    const type = this.getType(),
      session = this.session;
    if (!window.YCSSourceTypes.isLocal(type)) return;
    if (!this.locations.length) await this.load();
    if (
      session !== this.session ||
      !this.$('connection-dialog').open ||
      type !== this.getType() ||
      !this.locations.length ||
      this.locked
    )
      return;
    this.setOptions(this.$('file-browser-location'), this.$('local-location').value || 'default');
    this.$('file-browser-search').value = '';
    this.$('file-browser-dialog').showModal();
    const file = this.$('local-file').value.replace(/\\/g, '/');
    await this.browse(file.split('/').slice(0, -1).join('/'), file);
  }
  clearSelection() {
    this.selected = null;
    this.$('file-browser-selection').value = '';
    this.$('use-server-file').disabled = true;
  }
  async browse(directory = '', initialFile) {
    const sequence = ++this.browseSequence,
      location = this.$('file-browser-location').value,
      type = this.getType();
    this.clearSelection();
    this.entries = [];
    this.directory = directory.replace(/\\/g, '/');
    this.$('file-browser-directory').value = this.directory;
    this.$('file-browser-entries').replaceChildren();
    this.$('file-browser-entries').setAttribute('aria-busy', 'true');
    this.$('file-browser-root').textContent =
      this.locations.find((item) => item.id === location)?.path || '';
    this.$('file-browser-breadcrumbs').replaceChildren();
    this.$('file-browser-up').disabled = !this.directory;
    this.$('file-browser-status').textContent = 'Reading server folder…';
    try {
      const result = await this.request('/data/local/browse', {
        location,
        directory: this.directory,
        type
      });
      if (
        sequence !== this.browseSequence ||
        !this.$('file-browser-dialog').open ||
        type !== this.getType()
      )
        return;
      this.directory = result.directory;
      this.entries = result.entries;
      this.$('file-browser-directory').value = result.directory;
      this.$('file-browser-up').disabled = !result.directory;
      this.$('file-browser-status').textContent = result.truncated
        ? 'Showing the first 500 entries. Open a narrower folder or enter its path.'
        : result.entries.length
          ? 'Choose a file, then click Use file.'
          : 'No matching data files or folders in this location.';
      this.renderBreadcrumbs(result);
      this.renderEntries();
      const selected = this.entries.find(
        (item) => item.kind === 'file' && item.path === initialFile
      );
      if (selected) this.select(selected);
    } catch (error) {
      if (sequence === this.browseSequence && this.$('file-browser-dialog').open)
        this.$('file-browser-status').textContent = error.message;
    } finally {
      if (sequence === this.browseSequence)
        this.$('file-browser-entries').setAttribute('aria-busy', 'false');
    }
  }
  renderBreadcrumbs(result) {
    const crumbs = [[result.label, '']],
      parts = result.directory ? result.directory.split('/') : [];
    parts.forEach((part, index) => crumbs.push([part, parts.slice(0, index + 1).join('/')]));
    for (const [label, directory] of crumbs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = directory === result.directory;
      button.onclick = () => this.browse(directory);
      this.$('file-browser-breadcrumbs').append(button);
    }
  }
  renderEntries() {
    const target = this.$('file-browser-entries'),
      search = this.$('file-browser-search').value.toLowerCase();
    target.replaceChildren();
    for (const entry of this.entries.filter((entry) => entry.name.toLowerCase().includes(search))) {
      const button = document.createElement('button'),
        name = document.createElement('span'),
        kind = document.createElement('span');
      button.type = 'button';
      button.className = 'file-browser-entry';
      name.textContent = entry.name;
      kind.className = 'file-browser-kind';
      kind.textContent =
        entry.kind === 'directory' ? 'Folder ›' : entry.type === 'local-csv' ? 'CSV' : 'JSON';
      button.setAttribute(
        'aria-label',
        (entry.kind === 'directory' ? 'Open folder ' : 'Select file ') + entry.name
      );
      if (entry.kind === 'file')
        button.setAttribute('aria-pressed', String(this.selected?.path === entry.path));
      button.append(name, kind);
      button.onclick = () =>
        entry.kind === 'directory' ? this.browse(entry.path) : this.select(entry);
      target.append(button);
    }
  }
  select(entry) {
    this.selected = entry;
    this.$('file-browser-selection').value = entry.path;
    this.$('use-server-file').disabled = false;
    this.renderEntries();
  }
  apply() {
    if (!this.selected || this.$('use-server-file').disabled || this.locked) return;
    this.$('local-location').value = this.$('file-browser-location').value;
    this.$('local-file').value = this.selected.path;
    this.describe();
    this.invalidate();
    this.$('file-browser-dialog').close();
  }
  dispose() {
    this.sequence++;
    this.session++;
    this.browseSequence++;
    this.$('connection-dialog').removeEventListener('close', this.parentClosed);
    this.$('file-browser-dialog').removeEventListener('close', this.browserClosed);
  }
};
