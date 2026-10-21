import { createFavicon } from './favicon.js';

const ID = 'favicon-badges';

// The current host has no page-wide graph subscription in its public client
// API. Own a receive-only board connection rather than depending on card DOM.
export function createClient({
  document = globalThis.document, window = globalThis.window,
  WebSocket = globalThis.WebSocket, fetch = globalThis.fetch,
  setInterval = globalThis.setInterval, clearInterval = globalThis.clearInterval,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
} = {}) {
  const favicon = createFavicon({ document, fetch, setInterval, clearInterval });
  let socket = null, retry = null, disposed = false, suspended = false, attempt = 0;
  const endpoint = new URL('/ws', window.location.href);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

  function closeConnection() {
    if (retry !== null) { clearTimeout(retry); retry = null; }
    const current = socket;
    socket = null;
    if (current) {
      current.onmessage = current.onclose = current.onerror = null;
      current.close();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    closeConnection();
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    favicon.dispose();
  }

  function hide(event) {
    if (!event?.persisted) { dispose(); return; }
    suspended = true;
    closeConnection();
    favicon.reset();
  }

  function show(event) {
    if (event?.persisted && suspended && !disposed) {
      suspended = false;
      connect();
    }
  }

  function reconnect() {
    if (disposed || suspended) return;
    favicon.reset();
    if (retry !== null) return;
    const delay = Math.min(500 * 2 ** Math.min(attempt++, 5), 10000);
    retry = setTimeout(() => { retry = null; connect(); }, delay);
  }

  function connect() {
    if (disposed || suspended) return;
    let current;
    try { current = new WebSocket(endpoint.href); } catch { reconnect(); return; }
    socket = current;
    let announced = false;
    current.onmessage = (event) => {
      if (disposed || socket !== current) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'extensions') {
        // This arrives before a cached graph. A late module import after
        // disable/uninstall must stop here, even if that graph still says on.
        if (!Array.isArray(message.list) || !message.list.some((entry) => entry?.id === ID)) { dispose(); return; }
        announced = true;
      } else if (message.type === 'graph' && announced) {
        const graph = message.graph;
        const self = Array.isArray(graph?.extensions) ? graph.extensions.find((entry) => entry?.id === ID) : null;
        if (!self?.enabled) { dispose(); return; }
        attempt = 0;
        favicon.update(Array.isArray(graph.sessions) ? graph.sessions : [], self.settingValues || {});
      }
    };
    current.onclose = () => {
      if (disposed || socket !== current) return;
      socket = null;
      reconnect();
    };
    current.onerror = () => { /* Native WebSocket follows errors with close. */ };
  }

  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  connect();
  return { dispose };
}

let current = null;
export default {
  register() {
    current?.dispose();
    current = createClient();
  },
};
