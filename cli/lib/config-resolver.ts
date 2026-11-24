// ============================================================
// AI API Relay — Config Source Resolver
//
// Resolves configuration source from multiple inputs with priority:
// 1. CLI --config argument
// 2. Environment variables
// 3. Local config file (~/.ai-relay/relay-config.json)
// 4. Stored profile cloudUrl (from login)
// 5. Returns null (triggers interactive prompt)
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  ConfigSource,
  CloudConfigSource,
  FileConfigSource,
  InlineConfigSource,
  FileConfig,
} from './config-source';
import type { LocalProfile } from '../local/profile';
import { getProfileDir } from '../local/profile';
import { PROVIDERS } from '../../src/lib/providers/registry';

export interface ResolveConfigOptions {
  /**
   * Explicit config argument from CLI (--config parameter).
   * Can be a URL (http://...) or file path.
   */
  configArg?: string;

  /**
   * Loaded local profile (may contain cloudUrl from login).
   */
  profile?: LocalProfile | null;

  /**
   * Environment variables to check.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve a config source from various inputs with priority.
 *
 * Priority order (matches CLI_GUIDE.md):
 * 1. CLI --config argument (URL or file path)
 * 2. Explicit environment variables (RELAY_CONFIG_URL, RELAY_CLOUD_URL, RELAY_CONFIG_PATH)
 * 3. Local config file (~/.ai-relay/relay-config.json)
 * 4. Stored profile cloudUrl (from `airelay login`)
 * 5. Inline config from provider env vars (OPENAI_KEYS, CLAUDE_KEYS, etc.)
 * 6. null (no config source found)
 *
 * @returns ConfigSource or null if no source found
 */
export function resolveConfigSource(options: ResolveConfigOptions): ConfigSource | null {
  const { configArg, profile, env = process.env } = options;

  // 1. CLI --config argument
  if (configArg) {
    return createConfigSourceFromArg(configArg, profile);
  }

  // 2. Environment variables - explicit URL or path
  if (env.RELAY_CONFIG_URL || env.RELAY_CLOUD_URL) {
    const url = env.RELAY_CONFIG_URL || env.RELAY_CLOUD_URL;
    const deviceToken = profile?.deviceToken || env.RELAY_DEVICE_TOKEN || env.RELAY_ADMIN_KEY || env.RELAY_API_KEY;
    return new CloudConfigSource(url!, deviceToken);
  }

  if (env.RELAY_CONFIG_PATH) {
    return new FileConfigSource(env.RELAY_CONFIG_PATH);
  }

  // 3. Local config file (default location)
  const defaultConfigPath = path.join(getProfileDir(), 'relay-config.json');
  if (fs.existsSync(defaultConfigPath)) {
    return new FileConfigSource(defaultConfigPath);
  }

  // 4. Stored profile cloudUrl (from `airelay login`)
  if (profile?.cloudUrl) {
    return new CloudConfigSource(profile.cloudUrl, profile.deviceToken);
  }

  // 5. Inline config from provider environment variables
  const inlineConfig = buildInlineConfigFromEnv(env);
  if (inlineConfig) {
    return new InlineConfigSource(inlineConfig);
  }

  // 6. No config source found
  return null;
}

/**
 * Create config source from CLI argument.
 * Auto-detects whether it's a URL or file path.
 */
function createConfigSourceFromArg(
  configArg: string,
  profile?: LocalProfile | null
): ConfigSource {
  // Check if it's a URL
  if (configArg.startsWith('http://') || configArg.startsWith('https://')) {
    const deviceToken = profile?.deviceToken || process.env.RELAY_DEVICE_TOKEN || process.env.RELAY_ADMIN_KEY || process.env.RELAY_API_KEY;
    return new CloudConfigSource(configArg, deviceToken);
  }

  // Otherwise treat as file path
  // Resolve relative paths from current directory
  const resolvedPath = path.isAbsolute(configArg)
    ? configArg
    : path.resolve(process.cwd(), configArg);

  return new FileConfigSource(resolvedPath);
}

/**
 * Build inline config from environment variables.
 * Supports provider keys and basic routing config.
 *
 * Automatically discovers providers from XXX_KEYS environment variables.
 * Example: OPENAI_KEYS=sk-xxx will create an 'openai' provider.
 */
function buildInlineConfigFromEnv(env: NodeJS.ProcessEnv): FileConfig | null {
  const providers: FileConfig['providers'] = {};

  // Well-known provider mappings (for display names and default base URLs)
  const knownProviders: Record<string, { id?: string; name: string; defaultBaseUrl?: string; headerFormat?: 'openai' | 'anthropic' | 'azure'; modelPrefixes?: string[] }> = {
    'OPENAI': { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', headerFormat: 'openai', modelPrefixes: ['gpt-', 'chatgpt-'] },
    'CLAUDE': { id: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', headerFormat: 'anthropic', modelPrefixes: ['claude-'] },
    'ANTHROPIC': { id: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', headerFormat: 'anthropic', modelPrefixes: ['claude-'] },
    'GEMINI': { id: 'google', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', headerFormat: 'openai', modelPrefixes: ['gemini-'] },
    'GOOGLE': { id: 'google', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', headerFormat: 'openai', modelPrefixes: ['gemini-'] },
    'DEEPSEEK': { id: 'deepseek', name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', headerFormat: 'openai', modelPrefixes: ['deepseek-'] },
    'OPENROUTER': { id: 'openrouter', name: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', headerFormat: 'openai', modelPrefixes: ['openrouter/', 'openai/', 'anthropic/', 'google/', 'deepseek/', 'meta-llama/', 'x-ai/', 'qwen/', 'mistralai/'] },
    'SILICONFLOW': { id: 'siliconflow', name: 'SiliconFlow', defaultBaseUrl: 'https://api.siliconflow.cn/v1', headerFormat: 'openai', modelPrefixes: ['deepseek-ai/', 'Qwen/', 'THUDM/', 'Pro/'] },
    'GROQ': { id: 'groq', name: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', headerFormat: 'openai', modelPrefixes: ['llama-', 'mixtral-', 'gemma-'] },
    'OLLAMA': { id: 'ollama', name: 'Ollama Local', defaultBaseUrl: 'http://127.0.0.1:11434/v1', headerFormat: 'openai', modelPrefixes: ['llama', 'qwen', 'mistral', 'gemma'] },
    'XIAOMI': { id: 'xiaomi', name: 'MiMo (API Key)', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', headerFormat: 'openai', modelPrefixes: ['mimo-'] },
    'XIAOMI_CODING': { id: 'xiaomi_coding', name: 'MiMo (Coding Plan)', defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', headerFormat: 'openai', modelPrefixes: ['mimo-v2.6-pro-coding', 'mimo-v2.6-flash-coding'] },
    'XIAOMIMIMO_SGP_CODING': { id: 'xiaomi_sgp_coding', name: 'MiMo SGP (Coding Plan)', defaultBaseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', headerFormat: 'azure', modelPrefixes: ['mimo-v2.6-pro-sgp', 'mimo-v2.6-flash-sgp'] },
  };

  // Scan environment for XXX_KEYS patterns
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_KEYS') || !value) {
      continue;
    }

    // Extract provider prefix (e.g., "OPENAI" from "OPENAI_KEYS")
    const providerPrefix = key.slice(0, -5); // Remove "_KEYS"
    const knownInfo = knownProviders[providerPrefix];
    const providerId = knownInfo?.id || providerPrefix.toLowerCase();
    const baseUrlKey = `${providerPrefix}_BASE_URL`;
    const builtinDef = PROVIDERS[providerId];

    providers[providerId] = {
      name: providerId,
      displayName: knownInfo?.name || builtinDef?.displayName || toTitleCase(providerId),
      headerFormat: knownInfo?.headerFormat || builtinDef?.headerFormat || 'openai',
      modelPrefixes: knownInfo?.modelPrefixes || builtinDef?.modelPrefixes || [`${providerId}-`],
      envKeyField: key,
      apiKeys: value.split(',').map(k => k.trim()).filter(Boolean),
      baseUrl: env[baseUrlKey] || knownInfo?.defaultBaseUrl || builtinDef?.baseUrl || '',
      ...(builtinDef?.models ? { models: builtinDef.models } : {}),
    };
  }

  if (Object.keys(providers).length === 0) {
    return null;
  }

  return {
    version: 1,
    providers,
  };
}

/**
 * Convert kebab-case or snake_case to Title Case.
 * Example: "xiaomi-coding" → "Xiaomi Coding"
 */
function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get the default config file path.
 */
export function getDefaultConfigPath(): string {
  return path.join(getProfileDir(), 'relay-config.json');
}

/**
 * Check if a config file exists at the default location.
 */
export function hasDefaultConfig(): boolean {
  return fs.existsSync(getDefaultConfigPath());
}
