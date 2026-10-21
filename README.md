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
updates the favicon. This describes the current source, not a security boundary
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
- **Busy dot color**, **Needs input dot color**, **Completed tick color**, and
  **Failed cross color** accept six-digit hex colors such as `#22c55e`. Empty
  fields show the built-in color as a placeholder.

Settings save immediately on the server and are shared across browsers. Browsers
may slow flashing in background tabs. Only the browser tab favicon changes; pinned
app icons and home-screen icons retain their original artwork.

## Connection and compatibility

The current host client API does not expose a page-wide graph subscription. This
extension opens **one extra receive-only, same-origin `/ws` connection per tab** to
read the same extension announcements and session graph as the board. It sends no
control messages. It uses the host's existing settings controls and does not read
session cards, patch the board's sockets, or require additional host capabilities.

The board WebSocket protocol is currently unversioned. Compatibility is tested
against host API 1.40.0, so a future protocol change may require an extension update
even within the declared 1.x range.

On a dropped connection the icon returns to its original state while reconnecting
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
flashing, settings persistence, updates from another socket, and disable cleanup.
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
