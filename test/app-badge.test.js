import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionCount, createAppBadge } from '../public/app-badge.js';

const session = (sessionId, status, extra = {}) => ({ sessionId, status, managed: true, ...extra });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function harness(overrides = {}) {
  const calls = [];
  const navigator = { setAppBadge: (count) => { calls.push(['set', count]); }, clearAppBadge: () => { calls.push(['clear']); }, ...overrides.navigator };
  const Notification = { permission: 'default', requestPermission() { calls.push(['permission']); this.permission = 'granted'; return Promise.resolve('granted'); }, ...overrides.Notification };
  return { badge: createAppBadge({ navigator, Notification }), calls };
}

test('attention counts distinct failed or active needs-input sessions, including nested and dormant failures', () => {
  assert.equal(attentionCount([
    session('a', 'needs-you', { waitingReason: 'api-error' }),
    session('a', 'failed'),
    session('b', 'needs-you', { parentSession: 'a' }),
    session('c', 'idle', { managed: false, workflow: { phase: { label: 'failed' } } }),
    session('d', 'needs-you', { managed: false }),
    session('e', 'working'), session('f', 'idle'),
  ]), 3);
  assert.equal(attentionCount([session('a', 'idle')]), 0);
});

test('default-off and closing a tab never clear another tab badge; enabled no-attention does clear', async () => {
  const h = harness();
  h.badge.update([session('a', 'needs-you')], {});
  h.badge.dispose();
  assert.deepEqual(h.calls, []);
  const enabled = harness();
  enabled.badge.update([session('a', 'working')], { appBadge: true });
  await settle();
  assert.deepEqual(enabled.calls, [['clear']]);
  enabled.badge.dispose();
  assert.deepEqual(enabled.calls, [['clear']]);
});

test('pending calls serialize and coalesce to the latest clear after a global setting is turned off', async () => {
  const first = deferred();
  const h = harness({ navigator: { setAppBadge: (count) => { h.calls.push(['set', count]); return first.promise; } } });
  h.badge.update([session('a', 'needs-you')], { appBadge: true });
  h.badge.update([session('a', 'needs-you'), session('b', 'failed')], { appBadge: true });
  h.badge.update([], { appBadge: false });
  assert.deepEqual(h.calls, [['set', 1]]);
  first.resolve(); await settle();
  assert.deepEqual(h.calls, [['set', 1], ['clear']]);
  h.badge.dispose();
});

test('explicit extension disable clears after pending set, while ordinary close retains last known count', async () => {
  const first = deferred();
  const h = harness({ navigator: { setAppBadge: (count) => { h.calls.push(['set', count]); return first.promise; } } });
  h.badge.update([session('a', 'failed')], { appBadge: true });
  h.badge.dispose({ clear: true });
  first.resolve(); await settle();
  assert.deepEqual(h.calls, [['set', 1], ['clear']]);
  const retained = harness();
  retained.badge.update([session('a', 'failed')], { appBadge: true });
  await settle(); retained.badge.dispose(); await settle();
  assert.deepEqual(retained.calls, [['set', 1]]);
});

test('fresh successful graphs refresh app-wide state without retrying a rejected unchanged request', async () => {
  const h = harness();
  const attention = [session('a', 'needs-you')];
  h.badge.update(attention, { appBadge: true }); await settle();
  h.badge.update(attention, { appBadge: true }); await settle();
  assert.deepEqual(h.calls, [['set', 1], ['set', 1]], 'fresh graph heals another tab changing the shared badge');
  h.badge.dispose();
  const failing = harness({ navigator: { setAppBadge: () => { failing.calls.push(['set']); return Promise.reject(new Error('blocked')); } } });
  failing.badge.update(attention, { appBadge: true }); await settle();
  failing.badge.update(attention, { appBadge: true }); await settle();
  assert.equal(failing.calls.length, 1);
  assert.match(failing.badge.status().message, /rejected/i);
  failing.badge.dispose();
});

test('both API methods are required, and sync throws or rejections are contained', async () => {
  const unsupported = harness({ navigator: { clearAppBadge: undefined } });
  unsupported.badge.update([session('a', 'failed')], { appBadge: true });
  await unsupported.badge.requestPermission();
  assert.deepEqual(unsupported.calls, []);
  assert.equal(unsupported.badge.status().supported, false);
  const throwing = harness({ navigator: { setAppBadge() { throw new Error('blocked'); }, clearAppBadge() { throw new Error('blocked'); } } });
  throwing.badge.update([session('a', 'failed')], { appBadge: true }); await settle();
  throwing.badge.update([], { appBadge: false }); await settle();
  assert.match(throwing.badge.status().message, /off/i);
  throwing.badge.dispose();
});

test('only a deliberate permission request can prompt, and a late grant after disabling cannot reapply', async () => {
  const permission = deferred();
  const h = harness({ Notification: { requestPermission: () => { h.calls.push(['permission']); return permission.promise; } } });
  await h.badge.requestPermission();
  assert.deepEqual(h.calls, []);
  h.badge.update([session('a', 'failed')], { appBadge: true }); await settle();
  assert.deepEqual(h.calls, [['set', 1]], 'updates must not prompt');
  const requesting = h.badge.requestPermission();
  assert.deepEqual(h.calls.at(-1), ['permission'], 'request starts synchronously under user activation');
  h.badge.update([], { appBadge: false }); await settle();
  permission.resolve('granted'); await requesting; await settle();
  assert.deepEqual(h.calls, [['set', 1], ['permission'], ['clear']]);
  h.badge.dispose();
});

test('permission granted retries current count; denied, unsupported request and request failure are explained', async () => {
  const h = harness();
  h.badge.update([session('a', 'failed')], { appBadge: true }); await settle();
  await h.badge.requestPermission(); await settle();
  assert.deepEqual(h.calls, [['set', 1], ['permission'], ['set', 1]]);
  h.badge.dispose();
  for (const permission of ['granted', 'denied']) {
    const known = harness({ Notification: { permission } });
    known.badge.update([], { appBadge: true }); await settle();
    await known.badge.requestPermission();
    assert.equal(known.calls.some(([name]) => name === 'permission'), false);
    assert.match(known.badge.status().message, new RegExp(permission));
    known.badge.dispose();
  }
  const throwing = harness({ Notification: { requestPermission() { throw new Error('not allowed'); } } });
  throwing.badge.update([], { appBadge: true }); await settle();
  await throwing.badge.requestPermission();
  assert.match(throwing.badge.status().message, /permission.*failed/i);
  throwing.badge.dispose();
});


test('a live app window refreshes a shared badge after another closing window has a late pending set', async () => {
  const pending = deferred();
  let value = null;
  const navigator = { setAppBadge: (count) => pending.promise.then(() => { value = count; }), clearAppBadge: () => { value = 0; } };
  const closing = createAppBadge({ navigator });
  const live = createAppBadge({ navigator });
  closing.update([session('a', 'failed')], { appBadge: true });
  live.update([], { appBadge: true }); await settle();
  assert.equal(value, 0);
  closing.dispose(); pending.resolve(); await settle();
  assert.equal(value, 1, 'closing retains its last known request rather than clearing another window');
  live.update([], { appBadge: true }); await settle();
  assert.equal(value, 0, 'next live graph heals stale shared app state');
  const off = createAppBadge({ navigator });
  off.update([], {}); off.dispose();
  assert.equal(value, 0);
  live.dispose();
});

test('a deliberate permission retry during a pending rejected badge call waits for that call before retrying', async () => {
  let reject;
  const pending = new Promise((_resolve, no) => { reject = no; });
  let attempts = 0;
  const h = harness({ navigator: { setAppBadge: () => { attempts++; return attempts === 1 ? pending : Promise.resolve(); } }, Notification: { permission: 'granted' } });
  h.badge.update([session('a', 'failed')], { appBadge: true });
  await h.badge.requestPermission();
  assert.equal(attempts, 1);
  reject(new Error('permission changed')); await settle();
  assert.equal(attempts, 2);
  h.badge.dispose();
});


test('the browser permission property stays authoritative if permission is revoked after a previous grant', async () => {
  let prompts = 0;
  const Notification = { permission: 'default', requestPermission() { prompts++; this.permission = 'granted'; return Promise.resolve('granted'); } };
  const badge = createAppBadge({ navigator: { setAppBadge() {}, clearAppBadge() {} }, Notification });
  badge.update([], { appBadge: true });
  await badge.requestPermission();
  assert.equal(badge.status().permission, 'granted');
  Notification.permission = 'default';
  assert.equal(badge.status().permission, 'default');
  await badge.requestPermission();
  assert.equal(prompts, 2);
  badge.dispose();
});


test('an outstanding permission grant cannot set a badge after extension disposal', async () => {
  const permission = deferred();
  const h = harness({ Notification: { requestPermission: () => permission.promise } });
  h.badge.update([session('a', 'failed')], { appBadge: true }); await settle();
  const requesting = h.badge.requestPermission();
  h.badge.dispose({ clear: true }); await settle();
  permission.resolve('granted'); await requesting; await settle();
  assert.deepEqual(h.calls, [['set', 1], ['clear']]);
});

test('permission rejection and missing permission-request API are handled without disturbing app state', async () => {
  const rejected = harness({ Notification: { requestPermission: () => Promise.reject(new Error('permission unavailable')) } });
  rejected.badge.update([], { appBadge: true }); await settle();
  await rejected.badge.requestPermission();
  assert.match(rejected.badge.status().message, /permission.*failed/i);
  rejected.badge.dispose();
  const unavailable = createAppBadge({ navigator: { setAppBadge() {}, clearAppBadge() {} } });
  unavailable.update([], { appBadge: true }); await settle();
  await unavailable.requestPermission();
  assert.match(unavailable.status().message, /cannot request notification permission/i);
  unavailable.dispose();
});
