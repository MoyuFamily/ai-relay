import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveProvider, resolveFallbackModel, resolveUpstreamModel, clearProvidersCache, normalizeUpstreamBase, getUpstreamUrl, getUpstreamCountTokensUrl, getUpstreamResponsesUrl } from '../lib/providers/resolver';
import type { ProviderConfig } from '../lib/providers/types';
import {
  saveCustomProvider,
  __adminConfigCacheForTests,
  createMemoryMockKV,
} from '../lib/admin/admin-config';

describe('GPT provider resolution tests', () => {
  it('should route GPT models to OpenAI', async () => {
    const lunaProvider = await resolveProvider('gpt-6-luna');
    expect(lunaProvider).not.toBeNull();
    expect(lunaProvider?.name).toBe('openai');

    const solProvider = await resolveProvider('gpt-6.2-sol');
    expect(solProvider).not.toBeNull();
    expect(solProvider?.name).toBe('openai');

    const astraProvider = await resolveProvider('gpt-6.2-astra');
    expect(astraProvider).not.toBeNull();
    expect(astraProvider?.name).toBe('openai');

    const otherGptProvider = await resolveProvider('gpt-6-preview');
    expect(otherGptProvider).not.toBeNull();
    expect(otherGptProvider?.name).toBe('openai');
  });
});

describe('mimo-v2.6 provider resolution and mapping tests', () => {
  it('should resolve the correct provider for each mimo-v2.6 variant', async () => {
    // mimo-v2.6-flash-coding should resolve to xiaomi_coding
    const codingProvider = await resolveProvider('mimo-v2.6-flash-coding');
    expect(codingProvider).not.toBeNull();
    expect(codingProvider?.name).toBe('xiaomi_coding');

    // mimo-v2.6-flash-sgp should resolve to xiaomi_sgp_coding
    const sgpProvider = await resolveProvider('mimo-v2.6-flash-sgp');
    expect(sgpProvider).not.toBeNull();
    expect(sgpProvider?.name).toBe('xiaomi_sgp_coding');

    // mimo-v2.6-flash should resolve to xiaomi (since prefix is 'mimo-', which matches, and is standard)
    const baseProvider = await resolveProvider('mimo-v2.6-flash');
    expect(baseProvider).not.toBeNull();
    expect(baseProvider?.name).toBe('xiaomi');
  });

  it('should map the virtual model names to correct upstream model ID', async () => {
    const xiaomiProvider = await resolveProvider('mimo-v2.6-flash');
    const sgpProvider = await resolveProvider('mimo-v2.6-flash-sgp');
    const codingProvider = await resolveProvider('mimo-v2.6-flash-coding');

    expect(resolveUpstreamModel('mimo-v2.6-flash-coding', codingProvider!)).toBe('mimo-v2.6-flash');
    expect(resolveUpstreamModel('mimo-v2.6-flash-sgp', sgpProvider!)).toBe('mimo-v2.6-flash');
    expect(resolveUpstreamModel('mimo-v2.6-flash', xiaomiProvider!)).toBe('mimo-v2.6-flash');
  });

  it('should resolve correct fallback model for flash mimo-v2.6 models', async () => {
    const sgpFallback = await resolveFallbackModel('mimo-v2.6-flash', 'xiaomi_sgp_coding');
    expect(sgpFallback).toBe('mimo-v2.6-flash-sgp');

    const xiaomiFallback = await resolveFallbackModel('mimo-v2.6-flash', 'xiaomi');
    expect(xiaomiFallback).toBe('mimo-v2.6-flash');

    const codingFallback = await resolveFallbackModel('mimo-v2.6-flash', 'xiaomi_coding');
    expect(codingFallback).toBe('mimo-v2.6-flash-coding');
  });

  it('should resolve correct fallback model for pro model variants', async () => {
    const sgpFallback = await resolveFallbackModel('mimo-v2.6-pro', 'xiaomi_sgp_coding');
    expect(sgpFallback).toBe('mimo-v2.6-pro-sgp');

    const xiaomiFallback = await resolveFallbackModel('mimo-v2.6-pro', 'xiaomi');
    expect(xiaomiFallback).toBe('mimo-v2.6-pro');

    const codingFallback = await resolveFallbackModel('mimo-v2.6-pro', 'xiaomi_coding');
    expect(codingFallback).toBe('mimo-v2.6-pro-coding');
  });

  it('should support vision for all mimo-v2.6 flash and pro variants', async () => {
    const xiaomiProvider = await resolveProvider('mimo-v2.6-flash');
    const sgpProvider = await resolveProvider('mimo-v2.6-flash-sgp');
    const codingProvider = await resolveProvider('mimo-v2.6-flash-coding');
    const proProvider = await resolveProvider('mimo-v2.6-pro');

    expect(xiaomiProvider?.models?.find(m => m.id === 'mimo-v2.6-flash')?.supportsVision).toBe(true);
    expect(xiaomiProvider?.models?.find(m => m.id === 'mimo-v2.6-pro')?.supportsVision).toBe(true);

    expect(sgpProvider?.models?.find(m => m.id === 'mimo-v2.6-flash-sgp')?.supportsVision).toBe(true);
    expect(sgpProvider?.models?.find(m => m.id === 'mimo-v2.6-pro-sgp')?.supportsVision).toBe(true);

    expect(codingProvider?.models?.find(m => m.id === 'mimo-v2.6-flash-coding')?.supportsVision).toBe(true);
    expect(codingProvider?.models?.find(m => m.id === 'mimo-v2.6-pro-coding')?.supportsVision).toBe(true);

    expect(proProvider?.models?.find(m => m.id === 'mimo-v2.6-flash')?.supportsVision).toBe(true);
    expect(proProvider?.models?.find(m => m.id === 'mimo-v2.6-pro')?.supportsVision).toBe(true);
  });
});

describe('Custom provider exact match and wildcard prefix routing tests', () => {
  beforeEach(() => {
    __adminConfigCacheForTests.clear();
    clearProvidersCache();
    const mock = createMemoryMockKV();
    (global as any)._mockKVInstance = mock;
    (global as any)._mockKVInstance._isMock = true;
  });

  afterEach(() => {
    delete (global as any)._mockKVInstance;
    __adminConfigCacheForTests.clear();
    clearProvidersCache();
  });

  it('should only resolve exact match or wildcard prefixes, avoiding hijacking similar models', async () => {
    await saveCustomProvider({
      name: 'my_custom_provider',
      displayName: 'My Custom Provider',
      baseUrl: 'https://custom.example.com/v1',
      modelPrefixes: ['gpt-4'],
      headerFormat: 'openai',
      envKeyField: 'MY_CUSTOM_PROVIDER_KEYS',
      models: [{ id: 'gpt-4', displayName: 'GPT 4', contextWindow: 8192 }],
    });

    const gpt4Provider = await resolveProvider('gpt-4');
    expect(gpt4Provider).not.toBeNull();
    expect(gpt4Provider?.name).toBe('my_custom_provider');

    const gpt4oProvider = await resolveProvider('gpt-4o');
    expect(gpt4oProvider).not.toBeNull();
    expect(gpt4oProvider?.name).toBe('openai');

    const gpt41Provider = await resolveProvider('gpt-4.1');
    expect(gpt41Provider).not.toBeNull();
    expect(gpt41Provider?.name).toBe('openai');
  });

  it('should resolve wildcard prefixes correctly', async () => {
    await saveCustomProvider({
      name: 'wildcard_provider',
      displayName: 'Wildcard Provider',
      baseUrl: 'https://wildcard.example.com/v1',
      modelPrefixes: ['my-model-'],
      headerFormat: 'openai',
      envKeyField: 'WILDCARD_PROVIDER_KEYS',
      models: [{ id: 'my-model-v1', displayName: 'My Model V1', contextWindow: 8192 }],
    });

    const v2Provider = await resolveProvider('my-model-v2');
    expect(v2Provider).not.toBeNull();
    expect(v2Provider?.name).toBe('wildcard_provider');

    const baseProvider = await resolveProvider('my-model');
    expect(baseProvider).toBeNull();
  });

  it('should override built-in providers when a custom provider registers a duplicate model ID', async () => {
    // Save a custom provider registering 'gpt-5.4-mini' (which is otherwise a built-in openai model)
    await saveCustomProvider({
      name: 'custom_override_provider',
      displayName: 'Custom Override Provider',
      baseUrl: 'https://override.example.com/v1',
      modelPrefixes: ['gpt-5.4-mini'],
      headerFormat: 'openai',
      envKeyField: 'CUSTOM_OVERRIDE_KEYS',
      models: [{ id: 'gpt-5.4-mini', displayName: 'Custom GPT 5.4 Mini Override', contextWindow: 128000 }],
    });

    const provider = await resolveProvider('gpt-5.4-mini');
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe('custom_override_provider');
  });
});

import { validateBase64ImageSizes, validateRequestSize } from '../lib/relay/validation';

describe('base64 image size validation tests', () => {
  it('should pass validation for small base64 images', () => {
    const smallBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${smallBase64}` } }
          ]
        }
      ]
    };
    const result = validateBase64ImageSizes(body);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should fail validation and return error message for base64 images exceeding 1MB', () => {
    const largeString = 'A'.repeat(2800000);
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this large image' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${largeString}` } }
          ]
        }
      ]
    };
    const result = validateBase64ImageSizes(body);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Base64 image size exceeds the limit of 1MB');
  });
});

describe('validateRequestSize (Cloudflare O(1) request-size cap)', () => {
  const original = process.env.RELAY_MAX_REQUEST_BYTES;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RELAY_MAX_REQUEST_BYTES;
    } else {
      process.env.RELAY_MAX_REQUEST_BYTES = original;
    }
  });

  it('passes a request under the default 10MB cap', () => {
    delete process.env.RELAY_MAX_REQUEST_BYTES;
    const result = validateRequestSize(5 * 1024 * 1024);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('passes a request exactly at the default cap', () => {
    delete process.env.RELAY_MAX_REQUEST_BYTES;
    const result = validateRequestSize(10 * 1024 * 1024);
    expect(result.valid).toBe(true);
  });

  it('rejects a request over the default cap with a size message', () => {
    delete process.env.RELAY_MAX_REQUEST_BYTES;
    const result = validateRequestSize(10 * 1024 * 1024 + 1);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds the limit');
  });

  it('honors a custom RELAY_MAX_REQUEST_BYTES override', () => {
    process.env.RELAY_MAX_REQUEST_BYTES = String(1024); // 1KB
    expect(validateRequestSize(1024).valid).toBe(true);
    expect(validateRequestSize(1025).valid).toBe(false);
  });

  it('disables the cap when RELAY_MAX_REQUEST_BYTES=0', () => {
    process.env.RELAY_MAX_REQUEST_BYTES = '0';
    const result = validateRequestSize(50 * 1024 * 1024);
    expect(result.valid).toBe(true);
  });

  it('falls back to the default cap on an invalid override', () => {
    process.env.RELAY_MAX_REQUEST_BYTES = 'not-a-number';
    expect(validateRequestSize(10 * 1024 * 1024).valid).toBe(true);
    expect(validateRequestSize(10 * 1024 * 1024 + 1).valid).toBe(false);
  });
});

describe('upstream URL construction', () => {
  it('defaults a bare origin to /v1', () => {
    expect(normalizeUpstreamBase('https://sub.100xlabs.space')).toBe('https://sub.100xlabs.space/v1');
    expect(normalizeUpstreamBase('https://sub.100xlabs.space/')).toBe('https://sub.100xlabs.space/v1');
  });

  it('leaves an existing version path untouched', () => {
    expect(normalizeUpstreamBase('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(normalizeUpstreamBase('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1');
    expect(normalizeUpstreamBase('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(normalizeUpstreamBase('https://generativelanguage.googleapis.com/v1beta')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('strips trailing slashes from a versioned path', () => {
    expect(normalizeUpstreamBase('https://relay.example.com/v1/')).toBe('https://relay.example.com/v1');
  });

  const anthropicBare: ProviderConfig = {
    name: 'cc',
    displayName: 'Custom Claude',
    baseUrl: 'https://sub.100xlabs.space',
    modelPrefixes: ['claude-'],
    headerFormat: 'anthropic',
    envKeyField: 'CC_KEYS',
  };

  const openaiBare: ProviderConfig = {
    name: 'oa',
    displayName: 'Custom OpenAI',
    baseUrl: 'https://muyuan.do',
    modelPrefixes: ['gpt-'],
    headerFormat: 'openai',
    envKeyField: 'OA_KEYS',
  };

  it('builds an anthropic /messages URL under /v1 from a bare origin', () => {
    expect(getUpstreamUrl(anthropicBare)).toBe('https://sub.100xlabs.space/v1/messages');
    expect(getUpstreamCountTokensUrl(anthropicBare)).toBe('https://sub.100xlabs.space/v1/messages/count_tokens');
  });

  it('leaves an openai bare origin untouched (root vs /v1 is ambiguous; probed by key-test)', () => {
    // Unlike Anthropic, OpenAI-compatible gateways (NewAPI et al.) may serve the
    // API at the root or under /v1. We do not guess here — the base is used
    // as-is, and the admin key-test route probes both candidates.
    expect(getUpstreamUrl(openaiBare)).toBe('https://muyuan.do/chat/completions');
    expect(getUpstreamResponsesUrl(openaiBare)).toBe('https://muyuan.do/responses');
  });

  it('builds openai URLs from a versioned base as-is', () => {
    const openaiVersioned: ProviderConfig = { ...openaiBare, baseUrl: 'https://muyuan.do/v1' };
    expect(getUpstreamUrl(openaiVersioned)).toBe('https://muyuan.do/v1/chat/completions');
    expect(getUpstreamResponsesUrl(openaiVersioned)).toBe('https://muyuan.do/v1/responses');
  });

  it('does not double a version prefix when the base already has one', () => {
    const anthropicVersioned: ProviderConfig = { ...anthropicBare, baseUrl: 'https://api.anthropic.com/v1' };
    expect(getUpstreamUrl(anthropicVersioned)).toBe('https://api.anthropic.com/v1/messages');
  });
});
