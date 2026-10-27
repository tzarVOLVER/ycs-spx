// Dynamic per-output compositor. SPX HTML lifecycle is retained in each iframe.
const [, , stage, mode] = location.pathname.split('/');
const root = document.getElementById('composition');
const frames = new Map();
const retired = new Set();
let pending;
let running = false;
let disposed = false;
let revision = -1;
document.documentElement.dataset.stage = stage;
document.documentElement.dataset.mode = mode;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function timed(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Template lifecycle timed out')), milliseconds); })]).finally(() => clearTimeout(timer));
}
async function invoke(entry, method, ...args) {
  const callback = entry.frame.contentWindow[method];
  if (typeof callback !== 'function') throw new Error(`Template has no ${method} lifecycle`);
  await timed(Promise.resolve(callback.apply(entry.frame.contentWindow, args)), 8000);
}
async function mount(graphic) {
  const frame = document.createElement('iframe');
  frame.className = 'graphic';
  frame.dataset.graphic = graphic.id;
  frame.dataset.slot = graphic.slot;
  frame.style.zIndex = graphic.z;
  frame.title = `${stage} ${mode} ${graphic.id}`;
  const loaded = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; });
  const url = new URL(graphic.template, location.origin);
  url.searchParams.set('ycsStage', stage);
  url.searchParams.set('ycsMode', mode);
  frame.src = url;
  const entry = { frame, graphic, continuation: graphic.continuation || 0 };
  root.append(frame);
  try {
    await timed(loaded, 8000);
    await invoke(entry, 'update', JSON.stringify(graphic.data));
    await invoke(entry, 'play');
    entry.data = JSON.stringify(graphic.data);
    return entry;
  } catch (error) { frame.remove(); throw error; }
}
async function retire(entry) {
  retired.add(entry);
  try {
    await invoke(entry, 'stop');
    await delay(Math.min(entry.graphic.exitMs || 250, 2000));
  } catch (error) { console.warn('[YCS output]', error.message); }
  finally { entry.frame.remove(); retired.delete(entry); }
}
async function reconcile(snapshot) {
  const wanted = new Map(snapshot.graphics.map(graphic => [graphic.slot, graphic]));
  const outgoing = [];
  for (const [slot, entry] of frames) {
    const graphic = wanted.get(slot);
    if (!graphic) {
      frames.delete(slot);
      outgoing.push(retire(entry));
    }
  }
  // Retirement can animate while unrelated slots remain untouched.
  for (const graphic of snapshot.graphics) {
    let entry = frames.get(graphic.slot);
    if (!entry || graphic.id !== entry.graphic.id || graphic.template !== entry.graphic.template) {
      // Keep the previous graphic until the replacement has loaded successfully.
      const replacement = await mount(graphic);
      frames.set(graphic.slot, replacement);
      if (entry) outgoing.push(retire(entry));
      entry = replacement;
    } else {
      const data = JSON.stringify(graphic.data);
      if (entry.data !== data) { await invoke(entry, 'update', JSON.stringify(graphic.data)); entry.data = data; }
      if ((graphic.continuation || 0) !== entry.continuation) {
        await invoke(entry, 'next');
        entry.continuation = graphic.continuation || 0;
      }
      entry.graphic = graphic;
    }
  }
  await Promise.all(outgoing);
  root.dataset.revision = snapshot.revision;
  root.dataset.error = '';
}
async function drain() {
  if (running || disposed) return;
  running = true;
  while (pending && !disposed) {
    const snapshot = pending;
    pending = null;
    try { await reconcile(snapshot); }
    catch (error) {
      root.dataset.error = error.message;
      console.error('[YCS output]', error);
      // A failed template does not terminate this output's subscription.
    }
  }
  running = false;
}
const events = new EventSource(`/api/ycs/stages/${stage}/${mode}/events`);
events.addEventListener('state', event => {
  const snapshot = JSON.parse(event.data);
  if (snapshot.stage !== stage || snapshot.mode !== mode || snapshot.revision < revision) return;
  revision = snapshot.revision;
  pending = snapshot;
  document.documentElement.dataset.connection = 'connected';
  drain();
});
events.onerror = () => { document.documentElement.dataset.connection = 'reconnecting'; };
window.addEventListener('pagehide', () => {
  disposed = true;
  events.close();
  for (const entry of [...frames.values(), ...retired]) entry.frame.remove();
}, { once: true });
