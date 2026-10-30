import { createFavicon } from './favicon.js';
import { createAppBadge, permissionPanel } from './app-badge.js';
import { createJobAttention, loadJobsAttention as defaultJobsLoader } from './job-attention.js';

const ID = 'favicon-badges';

// The current host has no page-wide graph subscription in its public client
// API. Own a receive-only board connection rather than depending on card DOM.
export function createClient({
  document = globalThis.document, window = globalThis.window,
  WebSocket = globalThis.WebSocket, fetch = globalThis.fetch,
  navigator = globalThis.navigator, Notification = globalThis.Notification,
  loadJobsAttention = defaultJobsLoader, moduleUrl = import.meta.url,
  setInterval = globalThis.setInterval, clearInterval = globalThis.clearInterval,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
} = {}) {
  const favicon = createFavicon({ document, fetch, setInterval, clearInterval });
  const appBadge = createAppBadge({ navigator, Notification });
  let socket = null, retry = null, disposed = false, suspended = false, attempt = 0;
  let latestBadgeGraph = null, announcedJobs = false;
  const jobAttention = createJobAttention({ load: loadJobsAttention, changed: () => {
    if (!disposed && !suspended && socket && latestBadgeGraph) updateAppBadge(latestBadgeGraph);
  } });
  function updateAppBadge(graph) {
    const settings = graph.extensions.find((entry) => entry?.id === ID)?.settingValues || {};
    const sessions = Array.isArray(graph.sessions) ? graph.sessions : [];
    const allowed = settings.appBadge === true && announcedJobs
      && graph.extensions.some((entry) => entry?.id === 'jobs' && entry.enabled)
      && Array.isArray(graph.jobs?.jobs);
    const attention = jobAttention.update(sessions, graph.jobs, allowed);
    appBadge.update(attention.sessions, settings, attention);
  }
  // The host serves this module under <base>/ext/favicon-badges/.
  // Resolve from that served URL to retain the origin, port and base path.
  const endpoint = new URL('../../ws', moduleUrl);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

  function closeConnection() {
    latestBadgeGraph = null; announcedJobs = false; jobAttention.reset();
    if (retry !== null) { clearTimeout(retry); retry = null; }
    const current = socket;
    socket = null;
    if (current) {
      current.onmessage = current.onclose = current.onerror = null;
      current.close();
    }
  }

  function dispose({ clearBadge = false } = {}) {
    if (disposed) return;
    disposed = true;
    closeConnection();
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    favicon.dispose();
    jobAttention.dispose();
    appBadge.dispose({ clear: clearBadge });
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
    latestBadgeGraph = null; announcedJobs = false; jobAttention.reset();
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
        if (!Array.isArray(message.list) || !message.list.some((entry) => entry?.id === ID)) { dispose({ clearBadge: true }); return; }
        announced = true;
        announcedJobs = message.list.some((entry) => entry?.id === 'jobs');
      } else if (message.type === 'graph' && announced) {
        const graph = message.graph;
        const self = Array.isArray(graph?.extensions) ? graph.extensions.find((entry) => entry?.id === ID) : null;
        if (!self?.enabled) { dispose({ clearBadge: true }); return; }
        attempt = 0;
        const sessions = Array.isArray(graph.sessions) ? graph.sessions : [];
        const settings = self.settingValues || {};
        favicon.update(sessions, settings);
        latestBadgeGraph = graph;
        updateAppBadge(graph);
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
  return { dispose, subscribeBadge: appBadge.subscribe, requestBadgePermission: appBadge.requestPermission };
}

let current = null;
export default {
  register(slots) {
    current?.dispose();
    current = createClient();
    slots.register('settings.panel', permissionPanel(() => current));
  },
};
