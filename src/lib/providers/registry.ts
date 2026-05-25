// ============================================================
// AI API Relay — Provider Registry
// ============================================================

import type { ProviderConfig } from './types';

/**
 * All supported providers and their configurations.
 * To add a new provider, just add an entry here.
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  // ⚠️ lpgpt 排在 openai 前面，gpt-5.x 走 lpgpt，gpt-4o 等走 OpenAI
  lpgpt: {
    name: 'lpgpt',
    displayName: 'LPGPT (GPT-5)',
    baseUrl: 'https://lpgpt.us/v1',
    modelPrefixes: ['gpt-5.'],
    headerFormat: 'openai',
    envKeyField: 'LPGPT_KEYS',
    envBaseUrlField: 'LPGPT_BASE_URL',
    models: [
      { id: 'gpt-5.3', displayName: 'GPT-5.3', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-5.4', displayName: 'GPT-5.4', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-5.5', displayName: 'GPT-5.5', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
    ],
  },
  gw2_oops_asia: {
    name: 'gw2_oops_asia',
    displayName: 'GW2 Oops Asia',
    baseUrl: 'https://gw2.oops.asia/v1',
    modelPrefixes: ['gpt-5.3-codex', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3', 'gpt-4o', 'gpt-4-', 'gpt-3.5'],
    headerFormat: 'openai',
    envKeyField: 'GW2_OOPS_ASIA_KEYS',
    envBaseUrlField: 'GW2_OOPS_ASIA_BASE_URL',
    models: [
      { id: 'gpt-5.5', displayName: 'GPT-5.5', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-5.4', displayName: 'GPT-5.4', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-5.3', displayName: 'GPT-5.3', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', contextWindow: 128000, maxOutput: 4096, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', contextWindow: 16385, maxOutput: 4096, supportsStream: true, supportsTools: true },
    ],
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-', 'dall-e-'],
    headerFormat: 'openai',
    envKeyField: 'OPENAI_KEYS',
    envBaseUrlField: 'OPENAI_BASE_URL',
    models: [
      { id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 2.5, output: 10 } },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 0.15, output: 0.6 } },
      { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', contextWindow: 128000, maxOutput: 4096, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 10, output: 30 } },
      { id: 'o1', displayName: 'o1', contextWindow: 200000, maxOutput: 100000, supportsStream: true, supportsTools: true },
      { id: 'o1-mini', displayName: 'o1 Mini', contextWindow: 128000, maxOutput: 65536, supportsStream: true },
      { id: 'o3', displayName: 'o3', contextWindow: 200000, maxOutput: 100000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'o3-mini', displayName: 'o3 Mini', contextWindow: 200000, maxOutput: 100000, supportsStream: true, supportsTools: true },
      { id: 'o4-mini', displayName: 'o4 Mini', contextWindow: 200000, maxOutput: 100000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'chatgpt-4o-latest', displayName: 'ChatGPT-4o Latest', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', contextWindow: 16385, maxOutput: 4096, supportsStream: true, supportsTools: true, pricing: { input: 0.5, output: 1.5 } },
    ],
  },
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    modelPrefixes: ['claude-'],
    headerFormat: 'anthropic',
    envKeyField: 'CLAUDE_KEYS',
    envBaseUrlField: 'CLAUDE_BASE_URL',
    models: [
      { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', contextWindow: 200000, maxOutput: 32000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 15, output: 75 } },
      { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', contextWindow: 200000, maxOutput: 16000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 3, output: 15 } },
      { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', contextWindow: 200000, maxOutput: 8192, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 3, output: 15 } },
      { id: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', contextWindow: 200000, maxOutput: 8192, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 0.8, output: 4 } },
      { id: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', contextWindow: 200000, maxOutput: 4096, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 15, output: 75 } },
    ],
  },
  deepseek: {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    modelPrefixes: ['deepseek-'],
    headerFormat: 'openai',
    envKeyField: 'DEEPSEEK_KEYS',
    envBaseUrlField: 'DEEPSEEK_BASE_URL',
    models: [
      { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', contextWindow: 1048576, maxOutput: 393216, supportsStream: true, supportsTools: true, pricing: { input: 0.14, output: 0.28 } },
      { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindow: 1048576, maxOutput: 393216, supportsStream: true, supportsTools: true, pricing: { input: 0.435, output: 0.87 } },
    ],
  },
  // ⚠️ xiaomi 排在前面，同为 mimo- 前缀时优先作为默认解析
  xiaomi: {
    name: 'xiaomi',
    displayName: 'MiMo (API Key)',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    modelPrefixes: ['mimo-'],
    headerFormat: 'openai',
    envKeyField: 'XIAOMI_KEYS',
    envBaseUrlField: 'XIAOMI_BASE_URL',
    modelMapping: {
      'mimo-v2.5-pro-coding': 'mimo-v2.5-pro',
      'mimo-v2.5-pro-sgp': 'mimo-v2.5-pro',
      'mimo-v2.5-flash-sgp': 'mimo-v2.5-flash',
      'mimo-v2.5-coding': 'mimo-v2.5',
      'mimo-v2.5-sgp': 'mimo-v2.5',
    },
    models: [
      { id: 'mimo-v2.5', displayName: 'MiMo v2.5', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.5-pro', displayName: 'MiMo v2.5 Pro', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
    ],
  },
  xiaomi_sgp_coding: {
    name: 'xiaomi_sgp_coding',
    displayName: 'MiMo SGP (Coding Plan)',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    modelPrefixes: ['mimo-v2.5-pro-sgp', 'mimo-v2.5-flash-sgp', 'mimo-v2.5-sgp'],
    headerFormat: 'azure',
    envKeyField: 'XIAOMIMIMO_SGP_CODING_KEYS',
    envBaseUrlField: 'XIAOMIMIMO_SGP_CODING_BASE_URL',
    modelMapping: {
      'mimo-v2.5-pro-sgp': 'mimo-v2.5-pro',
      'mimo-v2.5-flash-sgp': 'mimo-v2.5-flash',
      'mimo-v2.5-sgp': 'mimo-v2.5',
    },
    models: [
      { id: 'mimo-v2.5-sgp', displayName: 'MiMo v2.5 (SGP Coding)', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.5-pro-sgp', displayName: 'MiMo v2.5 Pro (SGP Coding)', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.5-flash-sgp', displayName: 'MiMo v2.5 Flash (SGP Coding)', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true },
    ],
  },
  xiaomi_coding: {
    name: 'xiaomi_coding',
    displayName: 'MiMo (Coding Plan)',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    modelPrefixes: ['mimo-v2.5-pro-coding', 'mimo-v2.5-coding'],
    headerFormat: 'openai',
    envKeyField: 'XIAOMI_CODING_KEYS',
    envBaseUrlField: 'XIAOMI_CODING_BASE_URL',
    modelMapping: {
      'mimo-v2.5-pro-coding': 'mimo-v2.5-pro',
      'mimo-v2.5-coding': 'mimo-v2.5',
    },
    models: [
      { id: 'mimo-v2.5-coding', displayName: 'MiMo v2.5 (Coding)', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.5-pro-coding', displayName: 'MiMo v2.5 Pro (Coding)', contextWindow: 128000, maxOutput: 16384, supportsStream: true, supportsVision: true, supportsTools: true },
    ],
  },
  xiaomi_tudo: {
    name: 'xiaomi_tudo',
    displayName: 'xiaomi_tudo',
    baseUrl: 'https://test.404888.xyz/v1',
    modelPrefixes: ['mimo-v2.5-pro'],
    headerFormat: 'openai',
    envKeyField: 'XIAOMI_TUDO_KEYS',
    envBaseUrlField: 'XIAOMI_TUDO_BASE_URL',
    models: [
      { id: 'mimo-v2.5', displayName: 'MiMo-v2.5', contextWindow: 1048576, maxOutput: 32000, supportsStream: true, supportsVision: true },
      { id: 'mimo-v2.5-pro', displayName: 'MiMo-v2.5-Pro', contextWindow: 1048576, maxOutput: 32000, supportsStream: true, supportsVision: true }
    ],
  },
};

/** Known provider names (for usage trend queries etc.) */
export const PROVIDER_NAMES = Object.keys(PROVIDERS);
