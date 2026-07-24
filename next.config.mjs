import { execFileSync } from 'node:child_process';

function resolveDeployCommit() {
  const environmentCommit =
    process.env.NEXT_PUBLIC_DEPLOY_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA;

  if (environmentCommit) {
    return environmentCommit.trim();
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Edge Runtime is set per-route via export const runtime = 'edge'
  // No special config needed
  env: {
    NEXT_PUBLIC_DEPLOY_TIME: new Date().toISOString(),
    NEXT_PUBLIC_DEPLOY_COMMIT: resolveDeployCommit(),
  }
};

export default nextConfig;
