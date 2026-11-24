#!/usr/bin/env node
// ============================================================
// AI Relay — Multi-Platform Build Entrypoint
// ============================================================
// Runs `opennextjs-cloudflare build` automatically inside Cloudflare
// Workers Builds (`WORKERS_CI=1`), where the platform defaults to
// `pnpm run build` + `npx wrangler deploy`.
// Everywhere else (Vercel, Docker, GitHub CI, local dev) runs plain `next build`.
// Uses `OPENNEXT_BUILD_ACTIVE=1` to prevent recursion when OpenNext invokes `pnpm run build`.

import { spawnSync } from 'node:child_process';

const isWorkersCI = process.env.WORKERS_CI === '1' || process.env.WORKERS_CI === 'true';
const alreadyInOpenNext = process.env.OPENNEXT_BUILD_ACTIVE === '1';

const useOpenNext = isWorkersCI && !alreadyInOpenNext;
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = useOpenNext
  ? ['opennextjs-cloudflare', 'build', '--dangerouslyUseUnsupportedNextVersion']
  : ['next', 'build'];

if (useOpenNext) {
  console.log('[ai-relay] Cloudflare Workers Builds detected (WORKERS_CI=1) — running OpenNext build...');
}

const result = spawnSync(cmd, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(useOpenNext ? { OPENNEXT_BUILD_ACTIVE: '1' } : {}),
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
