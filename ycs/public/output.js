// Dynamic per-output compositor. SPX HTML lifecycle is retained in each iframe.
const [, , stage, mode] = location.pathname.split('/');
const root = document.getElementById('composition');
const frames = new Map();
const retired = new Set();
let pending;
let running = false;
let disposed = false;
let revision = -1;
// randomUUID is unavailable on ordinary LAN HTTP origins. getRandomValues
// remains available there; this ID identifies a renderer, not a credential.
const rendererId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
  Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
let renderedRevision = -1;
let renderingError = '';
async function report(state = renderingError ? 'error' : 'ready', keepalive = false) {
  try {
    await fetch(`/api/ycs/stages/${stage}/${mode}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive,
      body: JSON.stringify({ id: rendererId, state, revision: renderedRevision, message: renderingError.slice(0, 300) })
    });
  } catch { /* The controller marks missed heartbeats disconnected. */ }
}
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
    try { await reconcile(snapshot); renderedRevision = snapshot.revision; renderingError = ''; await report(); }
    catch (error) {
      root.dataset.error = error.message;
      console.error('[YCS output]', error);
      renderingError = error.message;
      await report();
      // A failed template does not terminate this output's subscription.
    }
  }
  running = false;
}
const events = io('/ycs-playback', { transports: ['websocket'], forceNew: true });
events.on('connect', () => {
  // Revisions are monotonic only within one server connection. A restarted
  // server starts at zero; its authoritative stopped state must replace the
  // retained composition. A reconnect to the same server still reuses frames.
  revision = -1;
  pending = null;
  events.emit('subscribe', { stage, modes: [mode] });
});
events.on('state', snapshot => {
  if (snapshot.stage !== stage || snapshot.mode !== mode || snapshot.revision < revision) return;
  revision = snapshot.revision;
  pending = snapshot;
  document.documentElement.dataset.connection = 'connected';
  drain();
});
function disconnected() { if (disposed) return; document.documentElement.dataset.connection = 'reconnecting'; renderingError = 'Output connection lost; retaining current graphics'; report(); }
events.on('disconnect', disconnected);
events.on('connect_error', disconnected);
events.on('stage-error', error => { renderingError = error.error; report(); });
const healthTimer = setInterval(() => report(), 5000);
window.addEventListener('pagehide', () => {
  disposed = true;
  clearInterval(healthTimer);
  report('closed', true);
  try { events.disconnect(); } catch { /* The browser may close the transport before pagehide. */ }
  for (const entry of [...frames.values(), ...retired]) entry.frame.remove();
}, { once: true });
