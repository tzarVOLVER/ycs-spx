// Story dialog rendering. Events describe edits; the draft owns their meaning.
window.YCSCollectionView = class CollectionView {
  constructor(editor) {
    this.editor = editor;
    this.$ = editor.$;
    Object.assign(this, window.YCSMappingDOM);
    this.$('close-playlist').onclick = () => editor.close();
    this.$('cancel-playlist').onclick = () => editor.close();
    this.$('test-playlist').onclick = () => editor.preview();
    this.$('use-playlist').onclick = () => editor.apply();
    this.onClose = () => editor.cancelPending();
    this.$('playlist-dialog').addEventListener('close', this.onClose);
  }
  get open() {
    return this.$('playlist-dialog').open;
  }
  get canApply() {
    return !this.$('use-playlist').disabled;
  }
  show(title) {
    this.$('playlist-title').textContent = 'Map ' + title;
    this.$('playlist-dialog').showModal();
  }
  close() {
    this.$('playlist-dialog').close();
  }
  waiting() {
    this.$('use-playlist').disabled = true;
    this.$('playlist-status').textContent = 'Previewing changes…';
  }
  noSource() {
    this.$('playlist-controls').replaceChildren(
      this.node('p', 'Add a Google Sheets or JSON API connection in Sources first.')
    );
    this.$('playlist-result').replaceChildren();
    this.$('playlist-status').textContent = '';
    this.$('test-playlist').disabled = this.$('use-playlist').disabled = true;
  }
  render(draft, sources) {
    const target = this.$('playlist-controls');
    target.replaceChildren();
    this.$('playlist-result').replaceChildren();
    this.$('playlist-status').textContent = '';
    const connection = this.control(
      sources.map(([id, value]) => [id, value.label]),
      draft.connectionId,
      'Playlist connection'
    );
    connection.onchange = () => this.editor.selectSource(connection.value);
    target.append(this.fieldLabel('Connection', connection));
    if (draft.format === 'sheet') {
      const layout = this.node('div', undefined, 'filters'),
        range = this.node('input'),
        header = this.node('input');
      range.value = draft.pick.range;
      range.setAttribute('aria-label', 'Playlist range');
      header.type = 'number';
      header.min = 1;
      header.value = draft.pick.headerRow;
      header.setAttribute('aria-label', 'Playlist header row');
      range.oninput = () => this.editor.editRange(range.value);
      header.onchange = () => this.editor.editHeader(header.value);
      layout.append(
        this.fieldLabel('Range within this connection', range),
        this.fieldLabel('Header row', header)
      );
      target.append(layout);
      if (draft.duplicates.length)
        target.append(
          this.node(
            'p',
            'Duplicate headers cannot be mapped: ' + draft.duplicates.join(', '),
            'warning'
          )
        );
    } else {
      const array = this.control(draft.arrays, draft.pick.pointer, 'Story array');
      array.onchange = () => this.editor.editArray(array.value);
      target.append(this.fieldLabel('Story array', array));
    }
    this.$('test-playlist').disabled = false;
    const table = this.node('table', undefined, 'playlist-map-table'),
      head = this.node('tr'),
      thead = this.node('thead'),
      body = this.node('tbody');
    for (const title of [
      'Story field',
      'Source column / property',
      'Transform',
      'Fixed value / fallback'
    ])
      head.append(this.node('th', title));
    thead.append(head);
    table.append(thead, body);
    target.append(table);
    for (const field of draft.controls) body.append(this.fieldRow(draft, field));
    target.append(
      this.node(
        'p',
        'Headers are matched by name, so columns can move. Renamed or missing headers need remapping. Unchecked rows are excluded; blank rows are ignored.',
        'hint'
      )
    );
  }
  fieldRow(draft, field) {
    const chosen = draft.selected(field),
      options = [
        ['', field.empty || 'Unused'],
        ['fixed', 'Fixed value'],
        ...draft.columns.map(([path, label]) => ['ref:' + path, label])
      ];
    const selected = !chosen
      ? ''
      : chosen.kind === 'static'
        ? 'fixed'
        : 'ref:' + (chosen.name ?? chosen.pointer);
    if (chosen && selected.startsWith('ref:') && !options.some(([key]) => key === selected))
      options.push([selected, (chosen.name ?? chosen.pointer) + ' (missing — remap)']);
    const input = this.control(options, selected, field.title + ' mapping'),
      text = this.node('input');
    text.value = chosen?.kind === 'static' ? chosen.value : chosen?.fallback || '';
    text.placeholder = selected === 'fixed' ? 'Fixed value' : 'Fallback for blank values';
    text.setAttribute('aria-label', field.title + ' fallback or fixed value');
    const transformCell = this.node('td');
    let transform, prefix;
    if (field.content) {
      transform = this.control(
        [
          ['none', 'None'],
          ['uppercase', 'Uppercase'],
          ['lowercase', 'Lowercase'],
          ['trim', 'Trim whitespace'],
          ['prefix', 'Prefix text']
        ],
        chosen?.transform?.kind || 'none',
        field.title + ' transform'
      );
      prefix = this.node('input');
      prefix.value = chosen?.transform?.kind === 'prefix' ? chosen.transform.value : '';
      prefix.placeholder = 'Prefix';
      prefix.maxLength = 200;
      prefix.setAttribute('aria-label', field.title + ' transform prefix');
      transformCell.append(transform, prefix);
    } else transformCell.textContent = '—';
    const paint = () => {
      text.disabled = !input.value;
      if (transform) {
        transform.disabled = !input.value;
        prefix.hidden = transform.value !== 'prefix';
        prefix.disabled = !input.value;
      }
    };
    const change = () => {
      paint();
      this.editor.editField(field, {
        source: input.value,
        text: text.value,
        transform: transform?.value || 'none',
        prefix: prefix?.value || ''
      });
    };
    paint();
    input.onchange = change;
    text.oninput = change;
    if (transform) {
      transform.onchange = change;
      prefix.oninput = change;
    }
    const row = this.node('tr'),
      source = this.node('td'),
      fallback = this.node('td');
    source.append(input);
    fallback.append(text);
    row.append(
      this.node('th', field.title + (field.required ? ' *' : '')),
      source,
      transformCell,
      fallback
    );
    return row;
  }
  result(field, schema) {
    const report = field.collection;
    this.$('playlist-status').textContent =
      field.error ||
      `${report?.included ?? 0} stories included · ${report?.excluded ?? 0} unpublished · source updates apply after the visible stories finish`;
    this.$('playlist-status').className = field.error ? 'warning' : 'connected';
    this.$('use-playlist').disabled = Boolean(field.error) || !report;
    this.renderResult(report, schema);
  }
  error(message) {
    this.$('playlist-status').textContent = message;
    this.$('playlist-status').className = 'warning';
    this.$('use-playlist').disabled = true;
    this.$('playlist-result').replaceChildren();
  }
  renderResult(report, schema) {
    const target = this.$('playlist-result');
    target.replaceChildren();
    if (!report) return;
    const table = this.node('table'),
      head = this.node('tr'),
      thead = this.node('thead'),
      body = this.node('tbody');
    for (const title of [
      'Source',
      'Playback',
      'State',
      ...schema.fields.map((field) => field.title),
      'Problem'
    ])
      head.append(this.node('th', title));
    thead.append(head);
    table.append(thead);
    for (const entry of report.rows) {
      if (entry.status === 'blank') continue;
      const row = this.node('tr');
      row.className = entry.status === 'invalid' ? 'field-warning' : '';
      for (const text of [
        entry.location,
        entry.position ?? '—',
        entry.status,
        ...schema.fields.map((field) => entry.values[field.key] || ''),
        entry.error || ''
      ])
        row.append(this.node('td', text));
      body.append(row);
    }
    table.append(body);
    target.append(table);
  }
  dispose() {
    this.$('playlist-dialog').removeEventListener('close', this.onClose);
    for (const id of ['close-playlist', 'cancel-playlist', 'test-playlist', 'use-playlist'])
      this.$(id).onclick = null;
  }
};
