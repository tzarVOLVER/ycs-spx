// Selects a server-side file. This never uploads files or changes a saved connection.
window.YCSLocalFilePicker = class LocalFilePicker {
  constructor({ request, invalidate, getType }) {
    Object.assign(this, { request, invalidate, getType });
    this.$ = (id) => document.getElementById(id);
    this.sequence = 0;
    this.$('refresh-local-files').onclick = () => this.load();
    this.$('local-file').onchange = () => this.invalidate();
    this.$('csv-delimiter').onchange = () => this.invalidate();
    this.$('connection-dialog').addEventListener('close', () => this.sequence++);
  }
  reset({ file = '', locked = false } = {}) {
    this.sequence++;
    this.file = file;
    this.locked = locked;
    this.$('local-file').replaceChildren();
    if (file) this.option(file);
    if (window.YCSSourceTypes.isLocal(this.getType())) this.load();
  }
  option(name, label = name) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = label;
    this.$('local-file').append(option);
  }
  async load() {
    const type = this.getType();
    if (!window.YCSSourceTypes.isLocal(type)) return;
    const sequence = ++this.sequence,
      selected = this.$('local-file').value || this.file;
    this.$('local-file-status').textContent = 'Loading server files…';
    this.$('refresh-local-files').disabled = true;
    try {
      const result = await this.request('/data/local/files');
      if (
        sequence !== this.sequence ||
        type !== this.getType() ||
        !this.$('connection-dialog').open
      )
        return;
      const files = result.files.filter((file) => file.type === type);
      this.$('local-file').replaceChildren();
      this.option('', 'Choose a server file…');
      for (const file of files) this.option(file.name);
      if (selected && !files.some((file) => file.name === selected))
        this.option(selected, selected + ' (missing)');
      this.$('local-file').value = selected || '';
      this.$('local-file').disabled = this.locked;
      this.$('local-file-status').textContent =
        'SPX server folder: ' +
        result.folder +
        (files.length ? '' : ' · Add a file here, then click Refresh files.');
    } catch (error) {
      if (sequence === this.sequence) this.$('local-file-status').textContent = error.message;
    } finally {
      if (sequence === this.sequence) this.$('refresh-local-files').disabled = false;
    }
  }
  dispose() {
    this.sequence++;
  }
};
