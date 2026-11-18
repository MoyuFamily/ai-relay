// ============================================================
// AI Relay CLI — Local Commands
// ============================================================

import { loadProfile, loadOrCreateProfile, createDefaultProfile } from './profile.js';
import { startLocalServer } from './server.js';
import { resolveConfigSource } from '../lib/config-resolver.js';

export interface StartCommandOptions {
  config?: string;
  port?: string;
  host?: string;
}

export async function startCommand(options: StartCommandOptions = {}) {
  // Load or create profile
  let profile = await loadProfile();

  if (!profile) {
    console.log('📝 No profile found, creating default profile...');
    profile = await loadOrCreateProfile();
  }

  // Override profile settings with CLI options
  if (options.port) {
    const port = parseInt(options.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`❌ Invalid port: ${options.port}`);
      console.error('   Port must be a number between 1 and 65535');
      process.exit(1);
    }
    profile.listenPort = port;
  }
  if (options.host) {
    profile.listenHost = options.host;
  }

  // Resolve config source
  const configSource = resolveConfigSource({
    configArg: options.config,
    profile,
    env: process.env,
  });

  if (!configSource) {
    console.error('❌ No configuration source found.\n');
    console.log('You can:');
    console.log('  1. Login to cloud: airelay login <cloud-url>');
    console.log('  2. Use local config: airelay local:start --config ./config.json');
    console.log('  3. Set environment: export RELAY_CONFIG_PATH=./config.json');
    console.log('  4. Use inline keys: export OPENAI_KEYS=sk-xxx\n');
    process.exit(1);
  }

  console.log('🚀 Starting AI Relay Local Server...\n');
  console.log(`   Device: ${profile.deviceName}`);
  console.log(`   Config: ${configSource.describe()}`);
  console.log(`   Listen: http://${profile.listenHost}:${profile.listenPort}\n`);

  const server = await startLocalServer({
    profile,
    configArg: options.config,
    configSource,
  });

  console.log('✅ Server started!\n');
  console.log(`   Health: http://${profile.listenHost}:${server.port}/health`);
  console.log(`   Endpoint: http://${profile.listenHost}:${server.port}/v1`);

  if (profile.cloudUrl) {
    console.log('\n🔄 Syncing config from cloud every 30s, heartbeat every 60s');
  } else {
    console.log('\n📋 Running in standalone mode (no cloud sync)');
  }

  console.log('   Press Ctrl+C to stop\n');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping server...');
    await server.stop();
    console.log('✅ Server stopped');
    process.exit(0);
  });
}

export async function statusCommand() {
  const profile = await loadProfile();

  console.log('\n📊 Local Relay Status\n');
  console.log('═══════════════════════════════════════\n');

  if (!profile) {
    console.log('❌ No profile found\n');
    console.log('Run one of these commands to get started:');
    console.log('  - airelay login <cloud-url>');
    console.log('  - airelay local:start --config ./config.json');
    console.log('  - export RELAY_CONFIG_PATH=./config.json\n');
    return;
  }

  // Device info
  console.log('Device:');
  console.log(`  Name: ${profile.deviceName}`);
  console.log(`  Listen: ${profile.listenHost}:${profile.listenPort}`);
  console.log();

  // Config source
  const configSource = resolveConfigSource({
    profile,
    env: process.env,
  });

  console.log('Configuration:');
  if (configSource) {
    console.log(`  Source: ${configSource.describe()}`);
    console.log(`  Version: ${profile.configVersion || 0}`);
    if (profile.lastSyncAt) {
      console.log(`  Last Sync: ${profile.lastSyncAt}`);
    }
  } else {
    console.log('  ❌ No config source configured');
  }
  console.log();

  // Cloud connection
  if (profile.cloudUrl) {
    console.log('Cloud:');
    console.log(`  URL: ${profile.cloudUrl}`);
    console.log(`  Device ID: ${profile.deviceId}`);
    console.log(`  Status: ${profile.deviceToken ? '✅ Connected' : '❌ Not authenticated'}`);
    console.log();
  }

  // Environment variables
  const envVars = [];
  if (process.env.RELAY_CONFIG_URL) envVars.push('RELAY_CONFIG_URL');
  if (process.env.RELAY_CONFIG_PATH) envVars.push('RELAY_CONFIG_PATH');
  if (process.env.OPENAI_KEYS) envVars.push('OPENAI_KEYS');
  if (process.env.CLAUDE_KEYS) envVars.push('CLAUDE_KEYS');
  if (process.env.DEEPSEEK_KEYS) envVars.push('DEEPSEEK_KEYS');

  if (envVars.length > 0) {
    console.log('Environment Variables:');
    envVars.forEach(v => console.log(`  ✓ ${v}`));
    console.log();
  }

  console.log('═══════════════════════════════════════\n');
}
