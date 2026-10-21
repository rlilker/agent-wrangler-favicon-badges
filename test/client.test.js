import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../public/index.js';

const id = 'favicon-badges';
const active = (status, extra = {}) => ({ managed: true, status, ...extra });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness({ fetch } = {}) {
  let href = 'favicon.svg';
  let writes = 0;
  const icon = { getAttribute: () => href, setAttribute: (_key, value) => { href = value; writes++; } };
  const document = { baseURI: 'https://example.com/', querySelector: () => icon };
  const handlers = new Map();
  const window = { location: new URL(document.baseURI), addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: (name) => handlers.delete(name) };
  const sockets = [];
  class WebSocket {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  const timers = new Map();
  let timerId = 0;
  const addTimer = (fn, delay) => { const key = ++timerId; timers.set(key, { fn, delay }); return key; };
  const client = createClient({ document, window, WebSocket, fetch: fetch || (async () => ({ ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1"/></svg>' })), setInterval: addTimer, clearInterval: (key) => timers.delete(key), setTimeout: addTimer, clearTimeout: (key) => timers.delete(key) });
  const message = (value, socket = sockets.at(-1)) => socket.onmessage?.({ data: JSON.stringify(value) });
  const announce = (list = [{ id }]) => message({ type: 'extensions', list });
  const graph = (sessions, settings = {}, extensions = [{ id, enabled: true, settingValues: settings }]) => message({ type: 'graph', graph: { sessions, extensions } });
  return { client, sockets, timers, handlers, message, announce, graph, href: () => href, writes: () => writes };
}
const svg = (h) => decodeURIComponent(h.href());

test('uses a receive-only same-origin connection and requires enabled announcement before graphs', async () => {
  const h = harness();
  assert.equal(h.sockets[0].url, 'wss://example.com/ws');
  h.graph([active('working')]);
  await tick();
  assert.equal(h.href(), 'favicon.svg');
  h.announce();
  h.graph([active('working')]);
  assert.match(svg(h), /#22c55e/);
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0];
  const writes = h.writes();
  h.graph([active('working')]);
  assert.equal(h.writes(), writes);
  assert.equal([...h.timers.values()][0], timer);
  timer.fn();
  assert.equal(h.href(), 'favicon.svg');
  h.graph([active('working')], { steady: true, busyColor: '#123456' });
  assert.match(svg(h), /#123456/);
  assert.equal(h.timers.size, 0);
  h.client.dispose();
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.handlers.size, 0);
});

test('missing announcement permanently disposes before a cached enabled graph can arrive', async () => {
  const h = harness();
  h.announce([]);
  h.graph([active('working')]);
  await tick();
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.handlers.size, 0);
});

test('self disable or removal on graph disposes and late asset fetch cannot resurrect a badge', async () => {
  let finish;
  const h = harness({ fetch: () => new Promise((resolve) => { finish = resolve; }) });
  h.announce();
  h.graph([active('working')]);
  await tick();
  h.graph([], {}, [{ id, enabled: false }]);
  finish({ ok: true, text: async () => '<svg></svg>' });
  await tick();
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.timers.size, 0);
  assert.equal(h.sockets[0].closed, true);
  const removed = harness();
  removed.announce();
  removed.graph([], {}, []);
  assert.equal(removed.sockets[0].closed, true);
});

test('disconnect restores the base, reconnect backs off with a bound and waits for fresh announcement', async () => {
  const h = harness();
  h.announce();
  h.graph([active('needs-you')]);
  await tick();
  assert.match(svg(h), /#f59e0b/);
  h.sockets[0].onclose();
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.timers.size, 1);
  const delays = [];
  for (let i = 0; i < 8; i++) {
    const [key, timer] = [...h.timers][0];
    delays.push(timer.delay); h.timers.delete(key); timer.fn();
    h.graph([active('working')]);
    assert.equal(h.href(), 'favicon.svg');
    h.sockets.at(-1).onclose();
  }
  assert.equal(delays[0], 500);
  assert.equal(delays.at(-1), 10000);
  assert.ok(delays.every((delay) => delay <= 10000));
  h.client.dispose();
  assert.equal(h.timers.size, 0);
});

test('pagehide cleans up resources, stale socket events and malformed messages cannot restore status', async () => {
  const h = harness();
  h.announce();
  h.graph([active('working')]);
  await tick();
  h.message(null);
  h.handlers.get('pagehide')();
  h.graph([active('working')]);
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.timers.size, 0);
  assert.equal(h.sockets[0].closed, true);
});

test('live graph settings and all badges update without selecting or rendering session cards', async () => {
  const h = harness();
  h.announce();
  await tick();
  h.graph([active('needs-you')], { steady: true });
  assert.match(svg(h), /#f59e0b/);
  h.graph([active('idle')]);
  assert.match(svg(h), /M13.5 17l2.3 2.5 4-5/);
  h.graph([active('needs-you', { waitingReason: 'api-error' })], { failedColor: '"><script/>' });
  assert.match(svg(h), /#ef4444/);
  assert.doesNotMatch(svg(h), /script/);
  h.graph([]);
  assert.equal(h.href(), 'favicon.svg');
  h.client.dispose();
});

test('failed favicon loading leaves original artwork and opens no flash timer', async () => {
  const h = harness({ fetch: async () => { throw new Error('offline'); } });
  h.announce(); h.graph([active('working')]);
  await tick();
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.timers.size, 0);
  h.client.dispose();
});

test('back-forward cache suspension restores the icon and starts a freshly authorized connection on return', async () => {
  const h = harness();
  h.announce(); h.graph([active('idle')]);
  await tick();
  assert.match(svg(h), /path/);
  h.handlers.get('pagehide')({ persisted: true });
  assert.equal(h.href(), 'favicon.svg');
  assert.equal(h.sockets[0].closed, true);
  h.handlers.get('pageshow')({ persisted: true });
  assert.equal(h.sockets.length, 2);
  h.graph([active('working')]);
  assert.equal(h.href(), 'favicon.svg');
  h.announce(); h.graph([active('idle')]);
  assert.match(svg(h), /path/);
  h.client.dispose();
  assert.equal(h.handlers.size, 0);
});
