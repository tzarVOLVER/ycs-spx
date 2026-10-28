// All mapping/collection request routes and request snapshots live here.
// The injected transport owns authentication, HTTP errors and JSON encoding.
window.YCSMappingAPI = class MappingAPI {
  constructor(request) {
    this.request = request;
    this.worksheetRequests = new Map();
  }
  graphics(stage) {
    return this.request(`/stages/${encodeURIComponent(stage)}/graphics`);
  }
  path(stage, graphic) {
    return `/data/mappings/${encodeURIComponent(stage)}/${encodeURIComponent(graphic)}`;
  }
  load(stage, graphic) {
    return this.request(this.path(stage, graphic));
  }
  preview(stage, graphic, edits) {
    return this.request(this.path(stage, graphic) + '/preview', { edits: structuredClone(edits) });
  }
  save(stage, graphic, body) {
    return this.request(this.path(stage, graphic), structuredClone(body));
  }
  previewCollection({ stage, graphic, model, field, binding, scope }) {
    const edits = [...model.edits.values()].filter((edit) => edit.field !== field);
    edits.push({ field, scope, binding });
    return this.preview(stage, graphic, edits);
  }
  worksheetNames(url) {
    if (!this.worksheetRequests.has(url)) {
      const request = this.request('/data/sheets/worksheets', { url })
        .then((result) => Object.fromEntries(result.worksheets.map((tab) => [tab.id, tab.name])))
        .catch(() => ({}));
      this.worksheetRequests.set(url, request);
    }
    return this.worksheetRequests.get(url);
  }
};
