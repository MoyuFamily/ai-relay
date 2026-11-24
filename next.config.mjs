import { execFileSync } from 'node:child_process';

function resolveDeployCommit() {
  const environmentCommit =
    process.env.NEXT_PUBLIC_DEPLOY_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.WORKERS_CI_COMMIT_SHA ||
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
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  env: {
    NEXT_PUBLIC_DEPLOY_TIME: new Date().toISOString(),
    NEXT_PUBLIC_DEPLOY_COMMIT: resolveDeployCommit(),
  },
};

export default nextConfig;
