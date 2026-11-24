#!/usr/bin/env node
// ============================================================
// AI Relay CLI — Cross-Platform Launcher
// ============================================================
// Avoids fragile `#!/usr/bin/env -S npx -y tsx` shebangs that
// fail on Windows or offline environments. Uses local/global tsx
// when present, otherwise falls back to `npx -y tsx`.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const entryTs = path.join(__dirname, 'index.ts');
const cliArgs = process.argv.slice(2);

const isWindows = process.platform === 'win32';
const localTsx = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  isWindows ? 'tsx.cmd' : 'tsx'
);

let cmd;
let args;

if (fs.existsSync(localTsx)) {
  cmd = localTsx;
  args = [entryTs, ...cliArgs];
} else {
  cmd = isWindows ? 'npx.cmd' : 'npx';
  args = ['-y', 'tsx', entryTs, ...cliArgs];
}

const result = spawnSync(cmd, args, {
  stdio: 'inherit',
  shell: isWindows,
});

if (result.error) {
  console.error(`Failed to launch airelay CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
