// ============================================================
// AI Relay CLI — Interactive Config Setup
//
// Guides users through initial configuration when no config
// source is found or via `airelay init`.
// ============================================================

import * as readline from 'readline';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDefaultConfigPath } from '../lib/config-resolver';
import type { FileConfig } from '../lib/config-source';
import { PROVIDERS } from '../../src/lib/providers/registry';

/**
 * Interactive configuration setup wizard.
 * Returns true if a usable local config file was written, false otherwise.
 */
export async function interactiveConfigSetup(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('\n🎉 Welcome to AI Relay Local!\n');
    console.log('Let\'s set up your local configuration.\n');

    const choice = await prompt(
      rl,
      'How would you like to configure AI Relay?\n' +
      '  1. Create local config file (~/.ai-relay/relay-config.json) [Recommended]\n' +
      '  2. Login to cloud / self-hosted Admin (sync keys & routing)\n' +
      '  3. Show environment variables snippet (quick one-off start)\n' +
      '  4. Skip (configure manually later)\n' +
      'Choose [1-4]: '
    );

    switch (choice.trim()) {
      case '1':
        return await setupLocalConfig(rl);
      case '2':
        await setupCloudLogin(rl);
        return false;
      case '3':
        await setupEnvVars(rl);
        return false;
      case '4':
        console.log('\nSkipping setup. You can configure later with:');
        console.log('  - airelay init');
        console.log('  - airelay login <cloud-url>');
        console.log('  - airelay local:start --config ./relay-config.json');
        console.log('  - OPENAI_KEYS=sk-xxx airelay local:start\n');
        return false;
      default:
        console.log('\n❌ Invalid choice. Exiting.\n');
        process.exit(1);
    }
  } finally {
    rl.close();
  }
}

async function setupCloudLogin(rl: readline.Interface): Promise<void> {
  console.log('\n📡 Cloud / Self-Hosted Admin Login\n');

  const cloudUrl = await prompt(rl, 'Enter your AI Relay URL (e.g., https://relay.example.com): ');

  if (!cloudUrl.trim()) {
    console.log('\n❌ No URL provided. Exiting.\n');
    process.exit(1);
  }

  console.log('\nRun these commands to bind this device and start:');
  console.log(`  airelay login ${cloudUrl.trim()}`);
  console.log('  airelay local:start\n');
}

async function setupLocalConfig(rl: readline.Interface): Promise<boolean> {
  console.log('\n📄 Local Config File Setup\n');

  const configPath = getDefaultConfigPath();
  console.log(`Target file: ${configPath}\n`);

  const config: FileConfig = {
    version: 1,
    providers: {},
    modelAliases: {
      aliases: {},
      hidden: [],
    },
    routing: {
      strategy: 'latency',
      fallbackChains: {},
    },
  };

  const openaiKey = await prompt(rl, 'OpenAI API Key (optional, press Enter to skip): ');
  if (openaiKey.trim()) {
    config.providers!.openai = {
      name: 'openai',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      headerFormat: 'openai',
      modelPrefixes: PROVIDERS.openai?.modelPrefixes || ['gpt-', 'chatgpt-'],
      envKeyField: 'OPENAI_KEYS',
      apiKeys: openaiKey.split(',').map((k) => k.trim()).filter(Boolean),
      models: PROVIDERS.openai?.models,
    };
  }

  const claudeKey = await prompt(rl, 'Anthropic (Claude) API Key (optional, press Enter to skip): ');
  if (claudeKey.trim()) {
    config.providers!.anthropic = {
      name: 'anthropic',
      displayName: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      headerFormat: 'anthropic',
      modelPrefixes: PROVIDERS.anthropic?.modelPrefixes || ['claude-'],
      envKeyField: 'CLAUDE_KEYS',
      apiKeys: claudeKey.split(',').map((k) => k.trim()).filter(Boolean),
      models: PROVIDERS.anthropic?.models,
    };
  }

  const geminiKey = await prompt(rl, 'Google Gemini API Key (optional, press Enter to skip): ');
  if (geminiKey.trim()) {
    config.providers!.google = {
      name: 'google',
      displayName: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      headerFormat: 'openai',
      modelPrefixes: PROVIDERS.google?.modelPrefixes || ['gemini-'],
      envKeyField: 'GEMINI_KEYS',
      apiKeys: geminiKey.split(',').map((k) => k.trim()).filter(Boolean),
      models: PROVIDERS.google?.models,
    };
  }

  const deepseekKey = await prompt(rl, 'DeepSeek API Key (optional, press Enter to skip): ');
  if (deepseekKey.trim()) {
    config.providers!.deepseek = {
      name: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      headerFormat: 'openai',
      modelPrefixes: PROVIDERS.deepseek?.modelPrefixes || ['deepseek-'],
      envKeyField: 'DEEPSEEK_KEYS',
      apiKeys: deepseekKey.split(',').map((k) => k.trim()).filter(Boolean),
      models: PROVIDERS.deepseek?.models,
    };
  }

  const openrouterKey = await prompt(rl, 'OpenRouter API Key (optional, press Enter to skip): ');
  if (openrouterKey.trim()) {
    config.providers!.openrouter = {
      name: 'openrouter',
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      headerFormat: 'openai',
      modelPrefixes: PROVIDERS.openrouter?.modelPrefixes || ['openrouter/'],
      envKeyField: 'OPENROUTER_KEYS',
      apiKeys: openrouterKey.split(',').map((k) => k.trim()).filter(Boolean),
      models: PROVIDERS.openrouter?.models,
    };
  }

  if (Object.keys(config.providers!).length === 0) {
    console.log('\n⚠️  No provider keys entered. You can edit the file later:');
    console.log(`   ${configPath}\n`);
  }

  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`\n✅ Config created: ${configPath}`);
    console.log('\n👉 Start the local relay with:');
    console.log('   airelay local:start\n');
    return Object.keys(config.providers!).length > 0;
  } catch (err) {
    console.error(`\n❌ Failed to create config: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

async function setupEnvVars(rl: readline.Interface): Promise<void> {
  console.log('\n🔧 Environment Variables Setup\n');
  console.log('Add these to your shell profile (~/.zshrc or ~/.bashrc):\n');

  const openaiKey = await prompt(rl, 'OpenAI API Key (optional, press Enter to skip): ');
  const claudeKey = await prompt(rl, 'Anthropic API Key (optional, press Enter to skip): ');
  const deepseekKey = await prompt(rl, 'DeepSeek API Key (optional, press Enter to skip): ');

  console.log('');
  if (openaiKey.trim()) console.log(`export OPENAI_KEYS="${openaiKey.trim()}"`);
  if (claudeKey.trim()) console.log(`export CLAUDE_KEYS="${claudeKey.trim()}"`);
  if (deepseekKey.trim()) console.log(`export DEEPSEEK_KEYS="${deepseekKey.trim()}"`);

  console.log('\nThen start the local relay:');
  console.log('  airelay local:start\n');
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}
