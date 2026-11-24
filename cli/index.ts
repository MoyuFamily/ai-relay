// ============================================================
// AI Relay CLI — Entry Point
// ============================================================

import { Command } from 'commander';
import * as os from 'os';
import pkg from '../package.json';

const SUPPORTED_AGENTS = ['codex', 'claude-code'] as const;

function normalizeAgentName(agent: string): (typeof SUPPORTED_AGENTS)[number] | null {
  const normalized = agent.trim().toLowerCase();
  if (normalized === 'codex') return 'codex';
  if (normalized === 'claude-code' || normalized === 'claude') return 'claude-code';
  return null;
}

const program = new Command();

program
  .name('airelay')
  .version(pkg.version)
  .description('AI Relay Local Runtime CLI');

program
  .command('init')
  .description('Interactive setup wizard for local relay configuration')
  .action(async () => {
    const { interactiveConfigSetup } = await import('./lib/interactive-config.js');
    await interactiveConfigSetup();
  });

program
  .command('login [cloud-url]')
  .description('Bind this device to a cloud or self-hosted admin instance (optional)')
  .action(async (cloudUrl?: string) => {
    if (!cloudUrl) {
      console.log('Cloud login is optional. You can also:');
      console.log('  - Run wizard:       airelay init');
      console.log('  - Use local config: airelay local:start --config ./relay-config.json');
      console.log('  - Set environment:  export RELAY_CONFIG_PATH=./relay-config.json');
      console.log('  - Use inline keys:  OPENAI_KEYS=sk-xxx airelay local:start');
      console.log('\nFor cloud login, provide the URL:');
      console.log('  airelay login <cloud-url>');
      return;
    }

    const { login } = await import('./local/login.js');
    await login(cloudUrl, { device_name: os.hostname(), platform: os.platform() });
  });

program
  .command('local')
  .description('Manage local relay server')
  .action(() => {
    program.help();
  });

program
  .command('local:start')
  .description('Start local relay server')
  .option('-c, --config <source>', 'Config source (URL or file path)')
  .option('-p, --port <port>', 'Listen port (default: 3147)')
  .option('--host <host>', 'Listen host (default: 127.0.0.1)')
  .action(async (options: { config?: string; port?: string; host?: string }) => {
    const { startCommand } = await import('./local/commands.js');
    await startCommand(options);
  });

program
  .command('local:status')
  .description('Show local relay status and configuration')
  .action(async () => {
    const { statusCommand } = await import('./local/commands.js');
    await statusCommand();
  });

program
  .command('agent:install <agent>')
  .description('Configure a local AI agent (supported: codex, claude-code)')
  .option('--dry-run', 'Show what would be changed')
  .action(async (agent: string, options: { dryRun?: boolean }) => {
    const resolved = normalizeAgentName(agent);
    if (!resolved) {
      console.error(`❌ Unsupported agent: "${agent}". Supported agents: ${SUPPORTED_AGENTS.join(', ')}`);
      process.exit(1);
    }

    const { loadOrCreateProfile } = await import('./local/profile.js');
    const profile = await loadOrCreateProfile();
    const localRelayUrl = `http://${profile.listenHost}:${profile.listenPort}`;
    const relayKey = process.env.RELAY_API_KEY || profile.deviceToken || 'local-relay';

    if (resolved === 'claude-code') {
      console.log('\n🔧 Add these lines to your shell profile (~/.zshrc or ~/.bashrc) to connect Claude Code:\n');
      console.log(`export ANTHROPIC_BASE_URL="${localRelayUrl}"`);
      console.log(`export ANTHROPIC_API_KEY="${relayKey}"\n`);
      return;
    }

    const { CodexAdapter } = await import('./agent/codex-adapter.js');
    const adapter = new CodexAdapter();

    const result = await adapter.install({
      localRelayUrl,
      relayKey,
      dryRun: options.dryRun || false,
    });

    if (result.success) {
      console.log(result.message);
    } else {
      console.error(`❌ ${result.message}`);
      process.exit(1);
    }
  });

program
  .command('agent:doctor <agent>')
  .description('Check agent configuration (supported: codex, claude-code)')
  .action(async (agent: string) => {
    const resolved = normalizeAgentName(agent);
    if (!resolved) {
      console.error(`❌ Unsupported agent: "${agent}". Supported agents: ${SUPPORTED_AGENTS.join(', ')}`);
      process.exit(1);
    }

    if (resolved === 'claude-code') {
      const { loadProfile } = await import('./local/profile.js');
      const profile = await loadProfile();
      const expected = `http://${profile?.listenHost || '127.0.0.1'}:${profile?.listenPort || 3147}`;
      const actual = process.env.ANTHROPIC_BASE_URL || '';
      const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
      console.log('\n🔍 Checking Claude Code environment:\n');
      console.log(`${actual === expected ? '✅' : '⚠️'} ANTHROPIC_BASE_URL`);
      console.log(`   Current: ${actual || '(unset)'} | Expected: ${expected}\n`);
      console.log(`${hasKey ? '✅' : '⚠️'} ANTHROPIC_API_KEY`);
      console.log(`   ${hasKey ? 'Configured' : 'Unset (run "airelay agent:install claude-code" for snippet)'}\n`);
      if (actual !== expected || !hasKey) process.exit(1);
      return;
    }

    const { CodexAdapter } = await import('./agent/codex-adapter.js');
    const adapter = new CodexAdapter();
    const result = await adapter.doctor();

    console.log(`\n🔍 Checking ${adapter.label} configuration:\n`);

    for (const check of result.checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log(`${icon} ${check.name}`);
      console.log(`   ${check.message}\n`);
    }

    if (result.ok) {
      console.log('✅ All checks passed!\n');
    } else {
      console.log('⚠️  Some checks failed\n');
      process.exit(1);
    }
  });

program
  .command('agent:uninstall <agent>')
  .description('Uninstall agent adapter (supported: codex)')
  .option('--dry-run', 'Show what would be changed')
  .action(async (agent: string, options: { dryRun?: boolean }) => {
    const resolved = normalizeAgentName(agent);
    if (!resolved) {
      console.error(`❌ Unsupported agent: "${agent}". Supported agents: ${SUPPORTED_AGENTS.join(', ')}`);
      process.exit(1);
    }
    if (resolved === 'claude-code') {
      console.log('Remove ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY from your shell profile (~/.zshrc / ~/.bashrc).');
      return;
    }

    const { CodexAdapter } = await import('./agent/codex-adapter.js');
    const adapter = new CodexAdapter();
    const result = await adapter.uninstall({ dryRun: options.dryRun });

    if (result.success) {
      console.log(result.message);
    } else {
      console.error(`❌ ${result.message}`);
      process.exit(1);
    }
  });

program.parse();
