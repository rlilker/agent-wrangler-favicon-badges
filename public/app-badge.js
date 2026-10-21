import { sessionFailed } from './favicon.js';

export function attentionCount(sessions) {
  return new Set(sessions.filter((s) => sessionFailed(s)
    || ((s.managed || s.restarting) && s.status === 'needs-you')).map((s) => s.sessionId ?? s)).size;
}

// App badges are shared by an installed app's windows, not owned by a tab. Default-off clients stay silent;
// closing/disconnecting retains the last known count. Only a live explicit off,
// extension removal, or an enabled graph without attention clears the badge.
export function createAppBadge({ navigator, Notification }) {
  const supported = typeof navigator?.setAppBadge === 'function' && typeof navigator?.clearAppBadge === 'function';
  let enabled = false, active = true, count = 0, generation = 0;
  let desired, attempted, running = false, refreshPending = false, error = '', permissionError = '', permissionResult = null;
  let permissionPending = null;
  const listeners = new Set();
  const permission = () => typeof Notification?.permission === 'string' ? Notification.permission : (permissionResult || 'unavailable');
  function status() {
    let message;
    if (!supported) message = 'This browser does not expose both app-badge methods. Favicon and title indicators remain available.';
    else if (!enabled) message = 'App-icon badging is off. Enable Show attention count on app icon below first.';
    else if (permissionError) message = permissionError;
    else if (error) message = 'App-icon badge request was rejected. Check app installation, notification permission and OS badge settings.';
    else if (permission() === 'granted') message = 'Notification permission is granted. App installation and OS settings still determine whether a badge is visible.';
    else if (permission() === 'denied') message = 'Notification permission is denied. Change it in browser or app settings if you want badges.';
    else if (typeof Notification?.requestPermission !== 'function') message = 'This browser cannot request notification permission here. App installation and OS settings still control badge visibility.';
    else message = 'If your browser requires notification permission for app badges, click Save below to request it.';
    return { supported, enabled, permission: permission(), message };
  }
  function notify() { for (const listener of listeners) { try { listener(status()); } catch { /* A settings panel must not break other indicators. */ } } }
  async function pump() {
    if (running || desired === undefined || desired === attempted) return;
    const target = desired;
    attempted = target; running = true;
    try {
      if (target > 0) await navigator.setAppBadge(target);
      else await navigator.clearAppBadge();
      error = '';
    } catch { error = 'rejected'; }
    finally {
      running = false;
      if (refreshPending) { attempted = undefined; refreshPending = false; }
      notify(); pump();
    }
  }
  function queue(value, force = false) {
    if (!supported) return;
    desired = value;
    if (force) {
      if (running) refreshPending = true;
      else attempted = undefined;
    }
    pump();
  }
  return {
    update(sessions, settings) {
      if (!active) return;
      const wasEnabled = enabled;
      enabled = settings.appBadge === true;
      count = attentionCount(sessions);
      if (wasEnabled !== enabled) { generation++; permissionError = ''; }
      // Refresh successful state on fresh graphs: another tab may have changed
      // the shared app badge. Do not hammer a rejected unchanged API request.
      if (enabled) queue(count, !error);
      else if (wasEnabled) queue(0);
      notify();
    },
    status,
    subscribe(listener) { listeners.add(listener); listener(status()); return () => listeners.delete(listener); },
    requestPermission() {
      // Called directly from the host settings Save click, before any await.
      if (!active || !enabled || !supported) { notify(); return Promise.resolve(); }
      permissionError = '';
      if (permission() === 'granted') { queue(count, true); notify(); return Promise.resolve(); }
      if (permission() === 'denied' || typeof Notification?.requestPermission !== 'function') { notify(); return Promise.resolve(); }
      if (permissionPending) return permissionPending;
      const started = generation;
      let request;
      try { request = Notification.requestPermission(); }
      catch { permissionError = 'Notification permission request failed. Check browser or app settings.'; notify(); return Promise.resolve(); }
      permissionPending = Promise.resolve(request).then((result) => {
        if (!active || !enabled || started !== generation) return;
        permissionResult = result;
        if (result === 'granted') queue(count, true);
      }).catch(() => {
        if (active && enabled && started === generation) permissionError = 'Notification permission request failed. Check browser or app settings.';
      }).finally(() => { permissionPending = null; notify(); });
      return permissionPending;
    },
    dispose({ clear = false } = {}) {
      if (!active) return;
      active = false; generation++;
      if (clear && enabled) queue(0);
      enabled = false;
      notify(); listeners.clear();
    },
  };
}

// Core always supplies a Save button for a settings panel. Use that real click
// as the permission action rather than adding a button next to a no-op Save.
export function permissionPanel(client) {
  const mounts = new WeakMap();
  return {
    id: 'app-badge-permission',
    mount(el) {
      const doc = el.ownerDocument;
      const heading = doc.createElement('div');
      heading.className = 'setting-label'; heading.textContent = 'App-icon badge permission';
      const help = doc.createElement('p');
      help.className = 'setting-help';
      help.textContent = 'For an installed web app: enable Show attention count on app icon, then use Save below to request browser notification permission if needed. This permission action sends no notifications. Other settings save immediately. API availability does not guarantee a visible OS badge.';
      const status = doc.createElement('p');
      status.className = 'setting-help'; status.dataset.appBadgePermission = '';
      status.setAttribute('role', 'status');
      el.append(heading, help, status);
      const unsubscribe = client().subscribeBadge((value) => { status.textContent = value.message; });
      mounts.set(el, unsubscribe);
    },
    save() { return client().requestBadgePermission(); },
    unmount(el) { mounts.get(el)?.(); mounts.delete(el); },
  };
}
