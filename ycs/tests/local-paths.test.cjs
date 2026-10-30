'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalFiles, normalizeLocalSettings, filePath } = require('../local-files.cjs');
const { DataSources } = require('../data.cjs');
test('full file paths accept copied quotes, local drives and UNC shares without accepting device paths or alternate streams', () => {
  const local = path.join(os.tmpdir(), 'Production Data', 'ticker.json');
  assert.equal(filePath('  "' + local + '"  '), local);
  assert.equal(
    normalizeLocalSettings({ file: local, refreshSeconds: 5 }, 'local-json').file,
    local
  );
  assert.throws(
    () =>
      normalizeLocalSettings(
        { file: local, location: 'production', refreshSeconds: 5 },
        'local-json'
      ),
    /full file path/
  );
  for (const file of [
    '../ticker.json',
    '\\\\?\\C:\\ticker.json',
    '\\\\.\\C:\\ticker.json',
    'ticker.json:stream',
    'ticker.json\u0000'
  ])
    assert.throws(() => filePath(file));
  if (process.platform === 'win32') {
    const share = '\\\\DATA-PC\\ProductionData\\ticker.csv';
    assert.equal(
      normalizeLocalSettings({ file: share, refreshSeconds: 5 }, 'local-csv').file,
      share
    );
    assert.throws(() => filePath('\\ticker.json'), /full drive/);
    assert.throws(() => filePath('C:\\Data\\CON\\ticker.json'));
  }
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ycs-paths-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'local'),
    shared = path.join(root, 'shared');
  await fs.mkdir(local);
  await fs.mkdir(path.join(shared, 'Orlando'), { recursive: true });
  await fs.writeFile(path.join(local, 'round.json'), '"LOCAL"');
  await fs.writeFile(path.join(shared, 'Orlando', 'round.json'), '"SHARED"');
  await fs.writeFile(path.join(shared, 'Orlando', 'ticker.csv'), 'Subtopic\nStory');
  await fs.writeFile(path.join(shared, 'ignored.txt'), 'Not data');
  return { root, local, shared };
}
test('legacy named locations and nested relative paths retain their settings and data', async (t) => {
  const f = await fixture(t),
    files = new LocalFiles(f.local, {
      locations: [{ id: 'production', label: 'Production data', path: f.shared }]
    });
  assert.equal(files.describe().locations.length, 2);
  const descriptor = files.describe();
  descriptor.locations[0].path = 'wrong';
  assert.equal(files.describe().locations[0].path, f.local);
  assert.equal(
    (await files.read({ location: 'production', file: 'Orlando\\round.json', refreshSeconds: 5 }))
      .data,
    'SHARED'
  );
  assert.equal((await files.read({ file: 'round.json', refreshSeconds: 5 })).data, 'LOCAL');
  assert.deepEqual(
    normalizeLocalSettings(
      { location: 'default', file: 'round.json', refreshSeconds: 5 },
      'local-json'
    ),
    { file: 'round.json', refreshSeconds: 5 }
  );
  await assert.rejects(
    files.read({ location: 'production', file: '../local/round.json', refreshSeconds: 5 }),
    /relative/
  );
  assert.throws(
    () =>
      new LocalFiles(f.local, {
        locations: [{ id: 'default', label: 'Duplicate', path: f.shared }]
      })
  );
  assert.throws(
    () =>
      new LocalFiles(f.local, { locations: [{ id: 'bad', label: 'Relative', path: '../outside' }] })
  );
});
test('folder junctions/symlinks cannot escape a configured location', async (t) => {
  const f = await fixture(t),
    target = path.join(f.root, 'outside');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'secret.json'), '"OUTSIDE"');
  try {
    await fs.symlink(
      target,
      path.join(f.local, 'shortcut'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Host does not allow test symlinks');
      return;
    }
    throw error;
  }
  const files = new LocalFiles(f.local);
  await assert.rejects(
    files.read({ file: 'shortcut/secret.json', refreshSeconds: 5 }),
    /regular folder/
  );
});
test('offline full-path reads coalesce OS work, keep other files responsive and recover', async (t) => {
  const f = await fixture(t);
  let calls = 0,
    release;
  const files = new LocalFiles(f.local, {
    locations: [{ id: 'network', label: 'Network', path: f.shared }],
    timeoutMs: 25,
    io: {
      ...fs,
      realpath: async (file) => {
        if (file === path.join(f.shared, 'Orlando')) {
          calls++;
          return new Promise(
            (resolve) => (release = () => resolve(path.join(f.shared, 'Orlando')))
          );
        }
        return fs.realpath(file);
      }
    }
  });
  const keepAlive = setTimeout(() => {}, 2000);
  t.after(() => clearTimeout(keepAlive));
  await assert.rejects(
    files.read({ file: path.join(f.shared, 'Orlando', 'round.json'), refreshSeconds: 5 }),
    (error) => error.status === 504
  );
  await assert.rejects(
    files.read({ file: path.join(f.shared, 'Orlando', 'round.json'), refreshSeconds: 5 }),
    (error) => error.status === 504
  );
  assert.equal(calls, 1);
  files.timeoutMs = 1000;
  assert.equal(
    (await files.read({ file: path.join(f.local, 'round.json'), refreshSeconds: 5 })).data,
    'LOCAL'
  );
  release();
  await new Promise((resolve) => setImmediate(resolve));
  files.io = fs;
  assert.equal(
    (await files.read({ file: path.join(f.shared, 'Orlando', 'round.json'), refreshSeconds: 5 }))
      .data,
    'SHARED'
  );
});
test('saved connection and binding identity distinguish locations with identical relative filenames', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.shared, 'round.json'), '"SHARED ROOT"');
  const localFiles = new LocalFiles(f.local, {
      locations: [{ id: 'network', label: 'Network', path: f.shared }]
    }),
    stages = [{ id: 'stage-1', project: 'Event' }],
    sources = new DataSources(path.join(f.root, 'sources.json'), stages, { localFiles });
  await sources.ready;
  t.after(() => sources.close());
  const a = (
      await sources.saveConnection(
        null,
        'Local',
        { file: 'round.json', refreshSeconds: 5 },
        0,
        'local-json'
      )
    ).connectionId,
    b = (
      await sources.saveConnection(
        null,
        'Shared',
        { location: 'network', file: 'round.json', refreshSeconds: 5 },
        sources.snapshot().revision,
        'local-json'
      )
    ).connectionId;
  const pick = (id) => ({ connection: id, selection: { kind: 'json', pointer: '' } });
  assert.equal(sources.previewBinding(pick(a)).value, 'LOCAL');
  assert.equal(sources.previewBinding(pick(b)).value, 'SHARED ROOT');
  await sources.saveMappings(
    'stage-1',
    'ticker',
    '/ticker.html',
    [{ field: 'f5', scope: 'override', binding: pick(b) }],
    sources.snapshot().revision
  );
  await assert.rejects(
    sources.saveConnection(
      b,
      'Shared',
      { file: 'round.json', refreshSeconds: 5 },
      sources.snapshot().revision,
      'local-json'
    ),
    (error) => error.status === 409
  );
  assert.equal(
    sources.value(sources.mapping('stage-1', 'ticker', 'f5', '/ticker.html')),
    'SHARED ROOT'
  );
});
