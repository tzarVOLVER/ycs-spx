// A server-side file path. Legacy relative connections keep their stored identity
// until the operator edits the path, so existing field mappings remain valid.
window.YCSLocalFileField = class LocalFileField {
  constructor({ request }) {
    this.request = request;
    this.input = document.getElementById('local-file');
    this.status = document.getElementById('local-file-status');
    this.sequence = 0;
  }
  settings() {
    return this.original && this.input.value === this.displayPath
      ? { ...this.original }
      : { file: this.input.value };
  }
  reset({ file = '', location, locked = false } = {}) {
    const sequence = ++this.sequence;
    this.original = file ? { file, ...(location ? { location } : {}) } : null;
    this.displayPath = file;
    this.input.value = file;
    this.input.readOnly = locked;
    this.status.textContent =
      'The SPX computer must be able to read this file. Network paths are supported.';
    if (!file || /^(?:[a-z]:[\\/]|[\\/])/i.test(file)) return;
    this.status.textContent = 'Loading the saved file path…';
    return this.request('/data/local/locations')
      .then((result) => {
        if (sequence !== this.sequence) return;
        const root = result.locations.find((item) => item.id === (location || 'default'));
        if (!root)
          throw new Error('The saved server location is unavailable. Enter a full file path.');
        this.displayPath = root.path.replace(/[\\/]+$/, '') + '/' + file;
        // Keep an operator edit made while location metadata was loading.
        if (this.input.value === file) this.input.value = this.displayPath;
        this.status.textContent =
          'The SPX computer reads this path automatically; the browser can be closed.';
      })
      .catch((error) => {
        if (sequence === this.sequence) this.status.textContent = error.message;
      });
  }
  dispose() {
    this.sequence++;
  }
};
