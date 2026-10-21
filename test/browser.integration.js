// Explicit opt-in integration: an unmodified host checkout supplies its own ws
// test transport. The shipped extension itself has no npm dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sleep = (ms) => new Promise((yes) => setTimeout(yes, ms));
async function until(fn, message) {
  let lastError;
  for (let n = 0; n < 100; n++) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await sleep(100);
  }
  assert.fail(lastError ? `${message}: ${lastError.stack || lastError}` : message);
}
async function listen(server) {
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return server.address().port;
}
async function freePort() { const s = createServer(); const port = await listen(s); await new Promise((yes) => s.close(yes)); return port; }
async function opened(socket) { await new Promise((yes, no) => { socket.addEventListener('open', yes, { once: true }); socket.addEventListener('error', no, { once: true }); }); }

// A transparent test proxy replaces only graph.sessions, so native board and
// extension connections see deterministic statuses while settings/install/
// disable messages still go through the real, unchanged host.
test('external extension loads on an unchanged host and reflects sessions, settings and disable', { timeout: 120000 }, async () => {
  const host = process.env.AW_TEST_HOST_REPO;
  assert.ok(host, 'set AW_TEST_HOST_REPO to an unmodified Agent Wrangler checkout');
  const chromePath = process.env.CHROME_BIN || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  ].find(existsSync);
  assert.ok(chromePath && existsSync(chromePath), 'Chrome required; set CHROME_BIN');
  const { default: Transport } = await import(pathToFileURL(join(resolve(host), 'node_modules/ws/index.js')).href);
  const WebSocketServer = Transport.Server;
  const data = mkdtempSync(join(tmpdir(), 'favicon-host-'));
  const profile = mkdtempSync(join(tmpdir(), 'favicon-chrome-'));
  let server, chrome, proxy, wss, cdp, control;
  const bridges = new Set();
  try {
    if (!process.env.AW_TEST_EXTENSION_URL) {
      const dest = join(data, 'extensions/favicon-badges');
      mkdirSync(dest, { recursive: true });
      for (const name of ['index.js', 'package.json', 'public', 'LICENSE']) cpSync(join(root, name), join(dest, name), { recursive: true });
    }
    const port = await freePort();
    const upstream = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server/index.js'], { cwd: host, env: {
      ...process.env, AW_DEV: '1', AW_DATA_DIR: data, AW_PORT: String(port), AW_OPEN_BROWSER: '',
    }, stdio: 'ignore' });
    await until(async () => (await fetch(upstream)).ok, 'isolated host failed to start');
    control = new Transport(`ws://127.0.0.1:${port}/ws`);
    const frames = [];
    control.on('message', (raw) => frames.push(JSON.parse(raw)));
    await opened(control);
    if (process.env.AW_TEST_EXTENSION_URL) {
      control.send(JSON.stringify({ type: 'ext-install', url: process.env.AW_TEST_EXTENSION_URL }));
      const disclosure = await until(() => frames.find((m) => m.type === 'ext-install-disclosure'), 'install disclosure missing');
      assert.equal(disclosure.id, 'favicon-badges');
      control.send(JSON.stringify({ type: 'ext-consent', tempId: disclosure.tempId, approve: true }));
      const done = await until(() => frames.find((m) => m.type === 'ext-install-done'), 'install did not complete');
      assert.equal(done.installed, true);
      assert.equal(done.active, true);
    }
    const original = await until(() => frames.findLast((m) => m.type === 'graph' && m.graph.extensions.some((e) => e.id === 'favicon-badges')), 'external extension missing from graph');
    const entry = original.graph.extensions.find((e) => e.id === 'favicon-badges');
    assert.equal(entry.external, true);
    assert.equal(entry.enabled, true);
    assert.equal(entry.quarantine, null);

    let fixture = [], latest = original;
    const transform = (raw) => {
      const frame = JSON.parse(raw);
      if (frame.type === 'graph') { latest = frame; frame.graph.sessions = fixture; }
      return JSON.stringify(frame);
    };
    proxy = createServer((req, res) => {
      const forward = request(upstream + req.url, { method: req.method, headers: req.headers }, (reply) => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
      forward.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(forward);
    });
    wss = new WebSocketServer({ noServer: true });
    proxy.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (down) => {
      const up = new Transport(`ws://127.0.0.1:${port}${req.url}`);
      const pair = { up, down }; bridges.add(pair);
      const pending = [];
      down.on('message', (raw) => { if (up.readyState === 1) up.send(raw.toString()); else pending.push(raw.toString()); });
      up.on('open', () => { for (const raw of pending) up.send(raw); });
      up.on('message', (raw) => { if (down.readyState === 1) down.send(req.url === '/ws' ? transform(raw) : raw); });
      down.on('close', () => { bridges.delete(pair); up.close(); });
      up.on('close', () => down.close()); up.on('error', () => down.close());
    }));
    const proxyPort = await listen(proxy);
    const url = `http://127.0.0.1:${proxyPort}/`;
    chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
    const debug = await until(() => readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Chrome failed to start');
    const target = await (await fetch(`http://127.0.0.1:${debug}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    cdp = new Transport(target.webSocketDebuggerUrl);
    await opened(cdp);
    let serial = 0;
    const pending = new Map(), errors = [];
    cdp.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.id) pending.get(message.id)?.(message);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    const call = (method, params = {}) => new Promise((yes, no) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); no(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, (reply) => { clearTimeout(timer); pending.delete(id); if (reply.error || reply.result?.exceptionDetails) no(new Error(JSON.stringify(reply))); else yes(reply.result); });
      cdp.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
    await call('Runtime.enable');
    await call('Page.navigate', { url });
    await until(() => bridges.size >= 2 && evaluate(`!!document.querySelector('.task-cell')`), 'native extension connection did not open alongside the board');
    const favicon = `document.querySelector('link[rel~="icon"]').getAttribute('href')`;
    assert.equal(await evaluate(favicon), 'favicon.svg');
    const setSessions = (sessions) => { fixture = sessions; const raw = JSON.stringify({ ...latest, graph: { ...latest.graph, sessions } }); for (const { down } of bridges) if (down.readyState === 1) down.send(raw); };
    const probe = { sessionId: 'favicon-probe', name: 'Favicon probe', agent: 'claude', managed: true, status: 'working', cwd: '/tmp' };
    setSessions([probe]);
    await until(() => evaluate(`${favicon}.startsWith('data:image/svg+xml,')`), 'busy badge missing');
    const generated = await evaluate(favicon);
    assert.match(decodeURIComponent(generated), /#22c55e/);
    await evaluate(`window.__iconDecoded = false; const img = new Image(); img.onload = () => { window.__iconDecoded = true; }; img.src = ${JSON.stringify(generated)};`);
    await until(() => evaluate('window.__iconDecoded'), 'favicon SVG does not decode');
    await until(() => evaluate(`${favicon} === 'favicon.svg'`), 'busy badge does not flash');
    await evaluate(`document.getElementById('settings-btn').click(); document.querySelector('[data-tab="extensions"]').click(); document.querySelector('.ext-list-row[data-ext-id="favicon-badges"] .ext-list-item').click();`);
    await evaluate(`document.querySelector('[data-ext="favicon-badges"][data-key="steady"] button').click();`);
    await evaluate(`const color = document.querySelector('[data-ext="favicon-badges"][data-key="busyColor"] input'); color.value = '#123456'; color.dispatchEvent(new Event('change', { bubbles: true }));`);
    const saved = () => JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')).extensionSettings?.['favicon-badges'];
    await until(() => saved()?.steady === true && saved()?.busyColor === '#123456', 'settings UI did not persist');
    await until(() => evaluate(`decodeURIComponent(${favicon}).includes('#123456')`), 'settings did not reach extension stream');
    // A different socket changing settings must also reach the browser.
    control.send(JSON.stringify({ type: 'ext-setting-set', id: 'favicon-badges', key: 'inputColor', value: '#abcdef' }));
    await until(() => latest.graph.extensions.find((e) => e.id === 'favicon-badges')?.settingValues.inputColor === '#abcdef', 'second-socket setting not broadcast');
    setSessions([{ ...probe, status: 'needs-you' }]);
    await until(() => evaluate(`decodeURIComponent(${favicon}).includes('#abcdef')`), 'input badge missing');
    setSessions([{ ...probe, status: 'idle' }]);
    await until(() => evaluate(`decodeURIComponent(${favicon}).includes('M13.5 17l2.3 2.5 4-5')`), 'completed tick missing');
    setSessions([{ ...probe, status: 'needs-you', waitingReason: 'api-error' }]);
    await until(() => evaluate(`decodeURIComponent(${favicon}).includes('#ef4444')`), 'failure cross missing');
    await evaluate(`document.querySelector('.ext-detail-head .setting-toggle').click();`);
    await until(async () => await evaluate(`${favicon} === 'favicon.svg'`) && bridges.size === 1, 'disable did not restore icon and close extension socket');
    assert.deepEqual(errors, []);
  } finally {
    cdp?.close(); control?.close();
    for (const { up, down } of bridges) { up.terminate(); down.terminate(); }
    wss?.close(); proxy?.closeAllConnections(); proxy?.close();
    chrome?.kill(); server?.kill();
    await sleep(500);
    for (const dir of [data, profile]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
