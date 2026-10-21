// Whole-board state, independent of filters, focus mode, or the selected view.
// Idle means a completed turn, as on the board. Dormant sessions are set aside
// for activity/completion, but a reported failure stays visible until resolved.
export function aggregateStatus(sessions = []) {
  const active = sessions.filter((s) => s.managed || s.restarting);
  if (sessions.some((s) => s.status === 'failed'
    || (s.status === 'needs-you' && (s.waitingReason === 'api-error' || s.waitingFor === 'container bring-up failed'))
    || s.workflow?.phase?.label?.toLowerCase() === 'failed')) return 'failed';
  if (active.some((s) => s.status === 'needs-you')) return 'input';
  if (active.some((s) => s.restarting || s.status === 'working' || s.hasBackgroundShell)) return 'busy';
  if (active.length && active.every((s) => s.status === 'idle')) return 'complete';
  return null;
}

const COLORS = { busy: '#22c55e', input: '#f59e0b', complete: '#22c55e', failed: '#ef4444' };
const COLOR_KEYS = { busy: 'busyColor', input: 'inputColor', complete: 'completeColor', failed: 'failedColor' };
const validColor = (color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);

function overlaySvg(base, status, color) {
  // Keep the original favicon artwork and add a contrasting lower-right badge.
  const shape = status === 'busy' || status === 'input'
    ? `<circle cx="18" cy="18" r="5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
    : `<circle cx="17" cy="17" r="6.5" fill="${color}" stroke="#fff" stroke-width="1"/><path d="${status === 'complete' ? 'M13.5 17l2.3 2.5 4-5' : 'M14.5 14.5l5 5m0-5l-5 5'}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  // Inline the base SVG with its own viewBox and styling: SVG favicons cannot
  // fetch external images. The shipped artwork uses the same 24-unit viewBox.
  const artwork = base.slice(base.indexOf('<svg')).replace(/<\/svg>\s*$/, '');
  return `data:image/svg+xml,${encodeURIComponent(`${artwork}<g>${shape}</g></svg>`)}`;
}


export function createFavicon({ document, fetch, setInterval, clearInterval }) {
  const icon = document.querySelector('link[rel~="icon"]');
  const original = icon?.getAttribute('href');
  const abort = new AbortController();
  let disposed = false, base = null, timer = null, signature = null;
  let sessions = [], settings = {};
  const write = (href) => { if (icon && icon.getAttribute('href') !== href) icon.setAttribute('href', href); };
  const clear = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const render = () => {
    if (disposed || !base) return;
    const status = aggregateStatus(sessions);
    const color = validColor(settings[COLOR_KEYS[status]]) ? settings[COLOR_KEYS[status]] : COLORS[status];
    const flash = settings.steady !== true && (status === 'busy' || status === 'input');
    const next = `${status}:${color}:${flash}`;
    if (next === signature) return;
    signature = next;
    clear();
    if (!status) { write(original); return; }
    const href = overlaySvg(base, status, color);
    write(href);
    if (flash) {
      let visible = true;
      timer = setInterval(() => { visible = !visible; write(visible ? href : original); }, 650);
    }
  };
  if (original) {
    Promise.resolve().then(() => fetch(new URL(original, document.baseURI).href, { signal: abort.signal }))
      .then((response) => { if (!response.ok) throw new Error('Favicon unavailable'); return response.text(); })
      .then((svg) => {
        if (disposed || !/<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg)) return;
        base = svg;
        render();
      }).catch(() => { /* A failed asset load leaves the original icon intact. */ });
  }
  return {
    update(nextSessions, nextSettings) { sessions = nextSessions; settings = nextSettings; render(); },
    reset() { sessions = []; settings = {}; signature = null; clear(); write(original); },
    dispose() { disposed = true; abort.abort(); clear(); write(original); },
  };
}
