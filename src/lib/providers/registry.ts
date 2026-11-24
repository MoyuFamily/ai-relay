// ============================================================
// AI API Relay — Provider Registry
// ============================================================
// Verified active API model lineups as of Nov 2026.

import type { ProviderConfig } from './types';

/**
 * All built-in providers and their active configurations.
 * Mainstream providers (OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter)
 * are listed first so new users get instant out-of-the-box support.
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelPrefixes: ['gpt-', 'chatgpt-'],
    headerFormat: 'openai',
    envKeyField: 'OPENAI_KEYS',
    envBaseUrlField: 'OPENAI_BASE_URL',
    models: [
      { id: 'gpt-6-luna', displayName: 'GPT-6 Luna', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 0.1, output: 0.5 } },
      { id: 'gpt-6.2-sol', displayName: 'GPT-6.2 Sol', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 2, output: 10 } },
      { id: 'gpt-6.2-astra', displayName: 'GPT-6.2 Astra', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 8, output: 40 } },
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
      { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 0.1, output: 0.5 } },
      { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 2, output: 10 } },
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 4, output: 20 } },
      { id: 'claude-fable-5-2', displayName: 'Claude Fable 5.2', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true, pricing: { input: 8, output: 40 } },
    ],
  },
  google: {
    name: 'google',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelPrefixes: ['gemini-'],
    headerFormat: 'openai',
    envKeyField: 'GEMINI_KEYS',
    envBaseUrlField: 'GEMINI_BASE_URL',
    models: [
      { id: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', contextWindow: 1000000, maxOutput: 65536, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gemini-4-argon', displayName: 'Gemini 4 Argon', contextWindow: 1000000, maxOutput: 65536, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gemini-4-neon', displayName: 'Gemini 4 Neon', contextWindow: 1000000, maxOutput: 65536, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', contextWindow: 1000000, maxOutput: 65536, supportsStream: true, supportsVision: true, supportsTools: true },
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
      { id: 'deepseek-flash', displayName: 'DeepSeek Flash', contextWindow: 1048576, maxOutput: 128000, supportsStream: true, supportsTools: true, pricing: { input: 0.3, output: 1.2 } },
      { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindow: 1048576, maxOutput: 128000, supportsStream: true, supportsTools: true, pricing: { input: 1.32, output: 3.96 } },
    ],
  },
  openrouter: {
    name: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelPrefixes: ['openrouter/', 'openai/', 'anthropic/', 'google/', 'deepseek/', 'meta-llama/', 'x-ai/', 'qwen/', 'mistralai/'],
    headerFormat: 'openai',
    envKeyField: 'OPENROUTER_KEYS',
    envBaseUrlField: 'OPENROUTER_BASE_URL',
    models: [
      { id: 'openai/gpt-6-luna', displayName: 'OpenRouter: GPT-6 Luna', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'anthropic/claude-sonnet-5-5', displayName: 'OpenRouter: Claude Sonnet 5.5', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'google/gemini-4-argon', displayName: 'OpenRouter: Gemini 4 Argon', contextWindow: 1000000, maxOutput: 65536, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'deepseek/deepseek-flash', displayName: 'OpenRouter: DeepSeek Flash', contextWindow: 1048576, maxOutput: 128000, supportsStream: true, supportsTools: true },
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
      'mimo-v2.6-pro-coding': 'mimo-v2.6-pro',
      'mimo-v2.6-pro-sgp': 'mimo-v2.6-pro',
      'mimo-v2.6-flash-coding': 'mimo-v2.6-flash',
      'mimo-v2.6-flash-sgp': 'mimo-v2.6-flash',
    },
    models: [
      { id: 'mimo-v2.6-flash', displayName: 'MiMo v2.6 Flash', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.6-pro', displayName: 'MiMo v2.6 Pro', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.6-pro-ultraspeed', displayName: 'MiMo v2.6 Pro Ultraspeed', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
    ],
  },
  xiaomi_sgp_coding: {
    name: 'xiaomi_sgp_coding',
    displayName: 'MiMo SGP (Coding Plan)',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    modelPrefixes: ['mimo-v2.6-pro-sgp', 'mimo-v2.6-flash-sgp'],
    headerFormat: 'azure',
    envKeyField: 'XIAOMIMIMO_SGP_CODING_KEYS',
    envBaseUrlField: 'XIAOMIMIMO_SGP_CODING_BASE_URL',
    modelMapping: {
      'mimo-v2.6-pro-sgp': 'mimo-v2.6-pro',
      'mimo-v2.6-flash-sgp': 'mimo-v2.6-flash',
    },
    models: [
      { id: 'mimo-v2.6-flash-sgp', displayName: 'MiMo v2.6 Flash (SGP Coding)', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.6-pro-sgp', displayName: 'MiMo v2.6 Pro (SGP Coding)', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
    ],
  },
  xiaomi_coding: {
    name: 'xiaomi_coding',
    displayName: 'MiMo (Coding Plan)',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    modelPrefixes: ['mimo-v2.6-pro-coding', 'mimo-v2.6-flash-coding'],
    headerFormat: 'openai',
    envKeyField: 'XIAOMI_CODING_KEYS',
    envBaseUrlField: 'XIAOMI_CODING_BASE_URL',
    modelMapping: {
      'mimo-v2.6-pro-coding': 'mimo-v2.6-pro',
      'mimo-v2.6-flash-coding': 'mimo-v2.6-flash',
    },
    models: [
      { id: 'mimo-v2.6-flash-coding', displayName: 'MiMo v2.6 Flash (Coding)', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
      { id: 'mimo-v2.6-pro-coding', displayName: 'MiMo v2.6 Pro (Coding)', contextWindow: 1000000, maxOutput: 128000, supportsStream: true, supportsVision: true, supportsTools: true },
    ],
  },
};

/** Known provider names (for usage trend queries etc.) */
export const PROVIDER_NAMES = Object.keys(PROVIDERS);
