# Favicon badges for Agent Wrangler

See session activity in your browser tab without opening the board. This standalone
Agent Wrangler extension overlays the existing
favicon with a status badge and requires no changes to Agent Wrangler itself.

## Install

In Agent Wrangler, open **Settings → Extensions → + Add extension** and paste:

```text
https://github.com/rlilker/agent-wrangler-favicon-badges
```

Review the extension and choose **Install**. It appears as **Favicon badges** under
Installed extensions and is enabled by default. Requires Agent Wrangler host API
**1.40.0 or later within 1.x**; tested against host API **1.40.0**.

### Why Wrangler shows a trust warning

Agent Wrangler shows a general trust warning when installing extensions. It imports
each extension's server entry point into its Node.js process without an enforced
sandbox. `requires: []` means this extension requests no host capabilities; it does
not restrict what its code could do.

In the current implementation, the [server entry](index.js) only declares browser
assets and settings, and the package has no npm dependencies. The browser code
reads session status and settings through a receive-only board connection and
updates the favicon and, optionally, the tab title and installed app badge. This describes the current
source, not a security boundary
or a guarantee that future versions cannot change.

Install only if you trust the author, and review the source and changes before
accepting updates.

## Badges

The extension reads all board sessions, including nested sessions, regardless of the
selected task, filters, focus mode or current view. When states coexist, the first
matching row wins:

| Priority | Session state | Default badge |
| --- | --- | --- |
| 1 | Any reported failure | Solid red cross |
| 2 | Any live session needs user input | Flashing orange dot |
| 3 | Any live session is working, has a background shell job or is restarting | Flashing green dot |
| 4 | All live sessions are idle | Solid green tick |

A tick means the agents have finished their current turns, rather than certifying
that their overall tasks succeeded. Reported failures are an explicit `failed`
status, an API error, a container startup failure, or a workflow phase labelled
`failed`. Individual tool errors do not imply session failure.

Dormant sessions are set aside for activity and completion. A reported failure still
shows red even if its session is dormant. With no reported failure, an empty board
or no live sessions leaves the original favicon. An unknown live state also leaves
the original icon unless another state takes priority.

## Settings

Open **Settings → Extensions → Favicon badges**:

- **Enabled** switches badges off and restores the original favicon.
- **Keep activity dots solid** stops activity dots flashing. Off by default.
- **Show status in tab title** adds a steady status prefix, for example
  `🟢 Working — Agent Wrangler`. Off by default; available in any browser.
- **Show attention count on app icon** requests a badge on an installed web app.
  Off by default; see [Installed app-icon badges](#installed-app-icon-badges).
- **Busy dot color**, **Needs input dot color**, **Completed tick color**, and
  **Failed cross color** accept six-digit hex colors such as `#22c55e`. Empty
  fields show the built-in color as a placeholder.

Settings save immediately on the server and are shared across browsers. Browsers
may slow flashing in background tabs. App-icon badging is a separate opt-in;
favicon color and flashing controls do not customize the OS app badge.

If favicon updates are unreliable in your browser, enable **Show status in tab
title** manually. It uses the same status and priority as the badges, with
`🟢 Working`, `🟠 Needs input`, `✅ Complete` or `❌ Failed` before the existing title.
The title stays steady and works independently of SVG loading. Turning the setting
off, disabling the extension, disconnecting, or having no active status restores
the original title.

## Installed app-icon badges

Enable **Show attention count on app icon** to request an installed app badge
through the browser's [Badging API](https://www.w3.org/TR/badging/). The count is
the number of distinct sessions needing attention: reported failures (including
dormant failures) or live sessions needing input. A session counts once even if
both apply; nested sessions count individually. Busy or completed sessions alone
clear the badge.

1. Install Agent Wrangler as a web app using your browser's install control.
   On supported Macs, Safari offers [File → Add to Dock](https://support.apple.com/en-ie/104996).
2. Open the installed app, then use its in-page **Settings → Extensions →
   Favicon badges** to enable the app-icon setting.
3. In that installed app, read **App-icon badge permission**. If permission is
   needed, click **Save** to deliberately request notification permission there.
   Safari web-app permission is separate from permission in a browser tab.
   Save is the permission action; the other controls already save immediately.

This extension never prompts automatically and sends no notifications or push
messages. If permission is denied, change it in the browser or app's settings.
Permissions and API availability do not guarantee a visible badge. In particular,
[Chrome 152 on macOS requires app notification permission](https://developer.chrome.com/release-notes/152).
The browser can report permission granted and the badge request can succeed while
macOS still hides it; check **System Settings → Notifications → your installed
app → Badge app icon**. See [Chrome's macOS permission guidance](https://developer.chrome.com/blog/notification-attribution-macos).
The extension does not send a test notification to trigger an OS prompt.

| Platform | Expected installed-app behavior; native display not tested here |
| --- | --- |
| Windows | Supporting Chrome/Edge web apps can show an attention number on the taskbar icon. Installation and OS badge settings apply. [Browser support](https://developer.chrome.com/docs/capabilities/web-apis/badging-api). |
| macOS | Supporting installed Chrome/Edge or Safari web apps can show an attention number in the Dock. Browser and app notification permission plus OS badge settings apply. |
| ChromeOS | Supporting installed web apps show a [small circle on the shelf icon](https://chromeos.dev/en/posts/features-to-take-full-advantage-of-pwa-installation#badging), rather than necessarily showing the requested number. |
| Linux | Native app-icon integration is outside this extension's scope; no OS bridge is provided. API exposure or a resolved promise does not establish visible Linux badging. Use the favicon or title indicator. |

The OS chooses the badge's appearance: no custom colors, tick/cross shapes or
flashing are requested for app icons. Unsupported or rejected APIs leave the
favicon and title features working.

An app badge is shared by the installed app's windows. A fresh default-off tab
and closing a window do not clear another window's badge. Running opted-in pages
refresh it from fresh graphs. No attention, turning the setting off, or disabling
or uninstalling the extension clears it from connected pages. Disconnecting or
closing retains the last known badge, which can persist after every window closes.
There are no background updates while all pages are closed; open an enabled page
to refresh stale state. The browser or OS may also clear a badge independently.

Automated tests mock the Badging and notification-permission APIs and verify calls,
counts, settings, a trusted permission click and cleanup. They do not verify native
Dock, taskbar or shelf pixels, real permission prompts or OS settings.

## Browser compatibility

The runtime uses standard browser APIs and updates an SVG data-URL favicon; it
has no Chrome-specific code. Expected desktop compatibility and completed tests
are different:

| Browser | Compatibility and verification |
| --- | --- |
| Chrome | Automated integration passes for page execution, SVG image decoding, flashing favicon-link updates, settings, title-status updates and cleanup. The test does not inspect pixels in the browser's native tab bar. |
| Firefox | Expected to work, but this extension has not been verified in Firefox. Firefox has supported SVG favicons [since version 41](https://www.firefox.com/en-US/firefox/41.0/releasenotes/). |
| Edge | Expected to work on [Chromium-based Edge](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/site-impacting-changes), but this extension has not been tested in Edge. |
| Safari | Safari 26 added [SVG and data-URL icon support](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#svg-icons). Live badge updates remain unverified; WebKit has an [open favicon-update report](https://bugs.webkit.org/show_bug.cgi?id=266426). Safari before 26 is incompatible with this SVG approach. |

Safari 26's supported image formats do not establish that its tab icon will update
while a page is open. Working Safari favicon badges cannot currently be promised.
The optional **Show status in tab title** setting provides a separate text status
without depending on live favicon updates; it is not automatically enabled for Safari.

To verify a browser release manually, record its version and operating system:

1. Watch the actual tab icon change through working, needs input, completed and
   failed states, checking the precedence when states coexist.
2. Check that busy/input dots flash, **Keep activity dots solid** stops flashing,
   and changing badge colors updates the displayed icon. Repeat in a background
   tab, allowing for browser timer throttling.
3. Enable **Show status in tab title** and check each steady status label. Turn
   it off, disable the extension, and disconnect in turn; check the original title
   and icon return as applicable, then re-enable or reconnect and check updates resume.

## Connection and compatibility

The current host client API does not expose a page-wide graph subscription. This
extension opens **one extra receive-only, same-origin `/ws` connection per tab** to
read the same extension announcements and session graph as the board. It sends no
control messages. It uses the host's existing settings controls and does not read
session cards, patch the board's sockets, or require additional host capabilities.

The board WebSocket protocol is currently unversioned. Compatibility is tested
against host API 1.40.0, so a future protocol change may require an extension update
even within the declared 1.x range.

On a dropped connection the favicon and title return to their original state while reconnecting
with a bounded backoff. Before applying a graph, each connection verifies that the
host still announces this extension. Disabling or uninstalling stops the connection
and clears timers, so a delayed module import cannot revive a disabled badge.
Leaving the page releases resources; a restored back-forward-cache page starts a
fresh, authorized connection. Failure to load the original SVG favicon keeps the
original icon instead of showing a badge.

## Development

Node.js **22 or later** is required. There are no npm dependencies or build step.

```sh
npm test
```

The explicit browser integration test requires an existing, unmodified Agent
Wrangler checkout with its own dependencies installed, and Chrome or Chromium:

```sh
AW_TEST_HOST_REPO=/path/to/agent-wrangler npm run test:browser
```

Set `CHROME_BIN` if the browser is installed outside the usual locations. The test
starts an isolated host with a temporary data directory, discovers this as an
external extension, and checks native browser connections, badge image decoding,
flashing, optional title status, settings persistence, updates from another socket,
and disable/disconnect cleanup. App-icon tests stub the native APIs; they do not
prove native icon rendering or permission dialogs.
A test-only transparent proxy supplies deterministic session graph fixtures; no host
source is modified and no real agent sessions are launched.

To exercise the host's real clone/disclosure/consent installation path from a
published repository instead of a local extension copy:

```sh
AW_TEST_HOST_REPO=/path/to/agent-wrangler \
AW_TEST_EXTENSION_URL=https://github.com/rlilker/agent-wrangler-favicon-badges \
npm run test:browser
```

That mode downloads and executes the selected repository in the isolated test host.
CI runs the dependency-free unit suite on Node.js 22 and 24. Browser integration
fails explicitly if its host checkout or browser is unavailable.

## License

[Apache-2.0](LICENSE).
