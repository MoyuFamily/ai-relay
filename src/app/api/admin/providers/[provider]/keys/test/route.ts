// ============================================================
// AI API Relay — Admin: Test API Key Connectivity
// POST /api/admin/providers/:provider/keys/test
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getManagedKeys, tryDecodeBase64 } from '@/lib/admin';
import { hashKey } from '@/lib/relay';
import { getAllProviders } from '@/lib/providers';
import { buildHeaders, transformToAnthropic } from '@/lib/relay/transform';
import { getUpstreamUrl, resolveFallbackModel, resolveUpstreamModel } from '@/lib/providers/resolver';
import type { ChatCompletionRequest } from '@/lib/types';
import type { ProviderConfig } from '@/lib/providers/types';

export const runtime = 'nodejs';
export const maxDuration = 15; // Max 15s duration for API route

type Params = Promise<{ provider: string }>;
const BROWSER_COMPAT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0',
];

function getFallbackOpenAIUrl(provider: ProviderConfig): string | null {
  if (provider.headerFormat !== 'openai') return null;
  const base = provider.baseUrl.trim().replace(/\/+$/, '');
  if (base.endsWith('/v1')) return null;
  return `${base}/v1/chat/completions`;
}

function summarizeUpstreamText(response: Response, text: string): string {
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.error || JSON.stringify(json);
  } catch {
    const trimmed = text.trim();
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') || /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      const title = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
      const description = trimmed.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
      const summary = [title, description].filter(Boolean).join(' - ');
      return summary || `${response.status} ${response.statusText || 'HTML error page from upstream'}`;
    }
    return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
  }
}

function isValidTestPayload(provider: ProviderConfig, payload: any): boolean {
  if (provider.headerFormat === 'anthropic') {
    return Array.isArray(payload?.content) || typeof payload?.id === 'string';
  }
  return Array.isArray(payload?.choices);
}

function shouldTryNext(response: Response, text: string): boolean {
  const contentType = response.headers.get('content-type') || '';
  const trimmed = text.trim();
  return contentType.includes('text/html') || /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed);
}

function getUserAgentCandidates(provider: ProviderConfig): Array<string | undefined> {
  const candidates: Array<string | undefined> = [
    provider.userAgent?.trim() || undefined,
    undefined,
    ...BROWSER_COMPAT_USER_AGENTS,
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate || '__default_sdk__';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * POST /api/admin/providers/:provider/keys/test
 *
 * Body: { key: "sk-..." } or { hash: "djb2hash" }
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const { provider: providerName } = await params;
  let body: { key?: string; hash?: string; model?: string; prompt?: string; providerConfig?: any };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  const allProviders = await getAllProviders(true);
  const provider = allProviders[providerName] ?? body.providerConfig;
  if (!provider || provider.name !== providerName) {
    return Response.json(
      { error: { message: `Unknown provider: ${providerName}`, code: 404 } },
      { status: 404 }
    );
  }

  let keyParam = body.key?.trim() || '';
  let hashParam = body.hash?.trim() || '';

  if (keyParam.startsWith('hash:')) {
    hashParam = keyParam.slice(5);
    keyParam = '';
  }

  let testKey = '';
  if (keyParam) {
    testKey = tryDecodeBase64(keyParam);
  } else if (hashParam) {
    // Locate plaintext key from managed KV or static env keys by matching hash
    const managed = await getManagedKeys(providerName);
    const envKeys = provider.envKeyField
      ? (process.env[provider.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const currentKeys = managed ?? envKeys;
    const match = currentKeys.find((k) => hashKey(k) === hashParam);
    if (!match) {
      return Response.json(
        { error: { message: `No key found with hash: ${hashParam}`, code: 404 } },
        { status: 404 }
      );
    }
    testKey = match;
  } else {
    // Default to the first configured key in the provider's key pool
    const managed = await getManagedKeys(providerName);
    const envKeys = provider.envKeyField
      ? (process.env[provider.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const currentKeys = managed ?? envKeys;
    if (currentKeys.length > 0) {
      testKey = currentKeys[0];
    }
  }

  if (!testKey) {
    return Response.json(
      { error: { message: `No configured API keys found for provider: ${provider.displayName}`, code: 400 } },
      { status: 400 }
    );
  }

  // Construct upstream request parameters
  const primaryUrl = getUpstreamUrl(provider);
  const fallbackUrl = getFallbackOpenAIUrl(provider);
  const urls = fallbackUrl && fallbackUrl !== primaryUrl ? [primaryUrl, fallbackUrl] : [primaryUrl];
  const userAgents = getUserAgentCandidates(provider);
  const isAnthropic = provider.headerFormat === 'anthropic';

  // Pick a widely-available, low-cost default test model per provider
  const DEFAULT_TEST_MODELS: Record<string, string> = {
    openai: 'gpt-6-luna',
    anthropic: 'claude-haiku-5-5',
    google: 'gemini-4-hydrogen',
    deepseek: 'deepseek-flash',
    openrouter: 'openai/gpt-6-luna',
    xiaomi: 'mimo-v2.6-flash',
  };
  const providerDefaultModel =
    DEFAULT_TEST_MODELS[providerName] ||
    provider.models?.[0]?.id ||
    (isAnthropic ? 'claude-haiku-5-5' : 'gpt-6-luna');
  const targetModel = (body.model && typeof body.model === 'string' && body.model.trim().length > 0)
    ? body.model.trim()
    : await resolveFallbackModel(providerDefaultModel, providerName);
  const upstreamModel = resolveUpstreamModel(targetModel, provider);

  const customPrompt = typeof body.prompt === 'string' && body.prompt.trim()
    ? body.prompt.trim().slice(0, 500)
    : null;
  const testBody: ChatCompletionRequest = {
    model: upstreamModel,
    messages: [{ role: 'user', content: customPrompt || 'ping' }],
    max_tokens: customPrompt ? 128 : 1,
  };
  const requestBody = isAnthropic ? transformToAnthropic(testBody) : testBody;

  let lastFailure: { status?: number; error: string } | null = null;
  const startedAt = Date.now();

  for (const url of urls) {
    for (const userAgent of userAgents) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), customPrompt ? 14000 : 10000);
      let upstreamResponse: Response;
      let responseText = '';
      try {
        upstreamResponse = await fetch(url, {
          method: 'POST',
          headers: buildHeaders(provider.headerFormat, testKey, false, undefined, userAgent),
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        responseText = await upstreamResponse.text();
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastFailure = {
          error: err.name === 'AbortError' ? 'Timeout (10s)' : err.message,
        };
        continue;
      }
      clearTimeout(timeoutId);

      let parsed: any = null;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        parsed = null;
      }

      if (upstreamResponse.ok && parsed && isValidTestPayload(provider, parsed)) {
        if (!customPrompt) {
          return Response.json({ valid: true });
        }
        let reply: string | undefined;
        if (provider.headerFormat === 'anthropic' && Array.isArray(parsed.content)) {
          reply = parsed.content
            .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
            .join('')
            .trim();
        } else if (Array.isArray(parsed.choices)) {
          const msgContent = parsed.choices[0]?.message?.content;
          if (typeof msgContent === 'string') {
            reply = msgContent.trim();
          }
        }
        return Response.json({
          valid: true,
          model: upstreamModel,
          latencyMs: Date.now() - startedAt,
          ...(reply ? { reply } : {}),
        });
      }

      const errorMessage = summarizeUpstreamText(upstreamResponse, responseText) || upstreamResponse.statusText;
      lastFailure = {
        status: upstreamResponse.status,
        error: errorMessage,
      };

      if (!shouldTryNext(upstreamResponse, responseText)) {
        break;
      }
    }
  }

  return Response.json({
    valid: false,
    status: lastFailure?.status,
    error: lastFailure?.error || 'Unknown upstream error',
  });
}
