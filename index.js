import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  id: 'favicon-badges',
  label: 'Favicon badges',
  description: 'Session activity and attention badges over the Agent Wrangler favicon.',
  help: 'Overlays the existing favicon for all sessions on the board. Failure takes priority over user input, then busy sessions, then completed turns. Turn off to restore the plain icon. Settings are shared across browsers.',
  author: 'rlilker',
  dir,
  defaultEnabled: true,
  requires: [],
  engines: { wranglerApi: '^1.40.0' },
  client: 'public/index.js',
  settings: [
    { key: 'steady', type: 'toggle', label: 'Keep activity dots solid', help: 'Stop the busy and needs-input dots flashing. By default they flash.' },
    { key: 'titleStatus', type: 'toggle', label: 'Show status in tab title', help: 'Prefix the tab title with a steady status label, useful when a browser does not refresh its favicon. Off by default.' },
    { key: 'appBadge', type: 'toggle', label: 'Show attention count on app icon', help: 'Request an installed app-icon badge for sessions needing input or reporting failure. Off by default; browser permission, installation and OS support control visibility.' },
    ...[
      ['busyColor', 'Busy dot color', '#22c55e'],
      ['inputColor', 'Needs input dot color', '#f59e0b'],
      ['completeColor', 'Completed tick color', '#22c55e'],
      ['failedColor', 'Failed cross color', '#ef4444'],
    ].map(([key, label, color]) => ({ key, type: 'text', label, help: 'Six-digit hex color, including #.', placeholder: color, pattern: '#[0-9a-fA-F]{6}', maxLength: 7 })),
  ],
};
