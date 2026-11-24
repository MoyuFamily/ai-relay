// ============================================================
// AI API Relay — Admin: Discover Provider Models
// POST /api/admin/providers/models
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getManagedKeys, tryDecodeBase64 } from '@/lib/admin';
import { hashKey } from '@/lib/relay';
import { getAllProviders } from '@/lib/providers';
import { buildHeaders } from '@/lib/relay/transform';
import type { ModelInfo, ProviderConfig } from '@/lib/providers/types';

export const runtime = 'nodejs';
export const maxDuration = 15;
const BROWSER_COMPAT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0',
];

type DiscoverModelsBody = {
  provider?: string;
  providerConfig?: ProviderConfig;
  key?: string;
  hash?: string;
};

function getModelsUrl(provider: ProviderConfig): string {
  const customBase = provider.envBaseUrlField ? process.env[provider.envBaseUrlField] : undefined;
  let base = (customBase || provider.baseUrl || '').trim().replace(/\/+$/, '');

  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/messages$/i, '');

  return `${base}/models`;
}

function normalizeModel(raw: any): ModelInfo | null {
  const id = typeof raw === 'string' ? raw : raw?.id;
  if (!id || typeof id !== 'string') return null;
  return {
    id,
    displayName: typeof raw?.displayName === 'string' ? raw.displayName : id,
    contextWindow: Number(raw?.contextWindow || raw?.context_window || raw?.context_length || 128000),
    maxOutput: Number(raw?.maxOutput || raw?.max_output || raw?.max_tokens || 4096),
    supportsStream: raw?.supportsStream ?? raw?.supports_stream ?? true,
    supportsVision: raw?.supportsVision ?? raw?.supports_vision ?? false,
    supportsTools: raw?.supportsTools ?? raw?.supports_tools ?? false,
    pricing: raw?.pricing || { input: 0, output: 0 },
  };
}

function extractModels(payload: any): ModelInfo[] {
  const source: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];

  const seen = new Set<string>();
  const normalized = source
    .map(normalizeModel)
    .filter((model): model is ModelInfo => Boolean(model));

  return normalized
    .filter((model: ModelInfo) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
}

async function resolveProviderFromBody(body: DiscoverModelsBody): Promise<ProviderConfig | null> {
  if (body.providerConfig?.name) return body.providerConfig;
  if (body.provider) {
    const providers = await getAllProviders(true);
    return providers[body.provider] || null;
  }
  return null;
}

async function resolveKeyFromBody(provider: ProviderConfig, body: DiscoverModelsBody): Promise<string> {
  let keyParam = body.key?.trim() || '';
  let hashParam = body.hash?.trim() || '';

  if (keyParam.startsWith('hash:')) {
    hashParam = keyParam.slice(5);
    keyParam = '';
  }

  if (keyParam) {
    return tryDecodeBase64(keyParam);
  }

  const managed = await getManagedKeys(provider.name);
  const envKeys = provider.envKeyField
    ? (process.env[provider.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
    : [];
  const currentKeys = managed ?? envKeys;

  if (hashParam) {
    const matched = currentKeys.find((key) => hashKey(key) === hashParam);
    if (!matched) throw new Error(`No key found with hash: ${hashParam}`);
    return matched;
  }

  if (currentKeys[0]) return currentKeys[0];
  throw new Error(`No configured API keys found for provider: ${provider.displayName}`);
}

async function readUpstreamError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      return json.error?.message || json.error || text;
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
  } catch (err: any) {
    return `Error reading upstream response: ${err.message}`;
  }
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('text/html');
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

async function retryHtmlResponseWithUserAgentCandidates(
  response: Response,
  url: string,
  provider: ProviderConfig,
  apiKey: string,
  signal: AbortSignal
): Promise<{ response: Response; userAgent: string | null }> {
  let selectedUserAgent = provider.userAgent?.trim() || null;
  if (!isHtmlResponse(response)) return { response, userAgent: selectedUserAgent };

  for (const userAgent of getUserAgentCandidates(provider).slice(1)) {
    try {
      const retryResponse = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(provider.headerFormat, apiKey, false, undefined, userAgent),
        signal,
      });
      if (retryResponse.ok && !isHtmlResponse(retryResponse)) {
        return { response: retryResponse, userAgent: userAgent || null };
      }
      if (!isHtmlResponse(retryResponse)) {
        response = retryResponse;
        selectedUserAgent = userAgent || null;
      }
    } catch {
      // Keep trying the remaining UA candidates.
    }
  }

  return { response, userAgent: selectedUserAgent };
}

export async function POST(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: DiscoverModelsBody;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  const provider = await resolveProviderFromBody(body);
  if (!provider) {
    return Response.json(
      { error: { message: 'Provider config is required', code: 400 } },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await resolveKeyFromBody(provider, body);
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'No API key available', code: 400 } },
      { status: 400 }
    );
  }

  let response: Response;
  let discoveredUserAgent: string | null = provider.userAgent?.trim() || null;
  let finalBaseUrl = provider.baseUrl;
  const initialUrl = getModelsUrl(provider);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    let res = await fetch(initialUrl, {
      method: 'GET',
      headers: buildHeaders(provider.headerFormat, apiKey, false, undefined, provider.userAgent),
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    if (isHtml || !res.ok) {
      if (!provider.baseUrl.endsWith('/v1') && !provider.baseUrl.endsWith('/v1/')) {
        const fallbackBase = `${provider.baseUrl.replace(/\/+$/, '')}/v1`;
        const fallbackUrl = `${fallbackBase}/models`;
        try {
          const fallbackRes = await fetch(fallbackUrl, {
            method: 'GET',
            headers: buildHeaders(provider.headerFormat, apiKey, false, undefined, provider.userAgent),
            signal: controller.signal,
          });
          const fallbackContentType = fallbackRes.headers.get('content-type') || '';
          const fallbackIsHtml = fallbackContentType.includes('text/html');
          if (fallbackRes.ok && !fallbackIsHtml) {
            res = fallbackRes;
            finalBaseUrl = fallbackBase;
          } else if (isHtml && !fallbackIsHtml) {
            res = fallbackRes;
            finalBaseUrl = fallbackBase;
          }
        } catch {
          // ignore fallback error and keep original response
        }
      }
    }
    response = res;
  } catch (err: any) {
    if (!provider.baseUrl.endsWith('/v1') && !provider.baseUrl.endsWith('/v1/')) {
      const fallbackBase = `${provider.baseUrl.replace(/\/+$/, '')}/v1`;
      const fallbackUrl = `${fallbackBase}/models`;
      try {
        const fallbackRes = await fetch(fallbackUrl, {
          method: 'GET',
          headers: buildHeaders(provider.headerFormat, apiKey, false, undefined, provider.userAgent),
          signal: controller.signal,
        });
        const fallbackContentType = fallbackRes.headers.get('content-type') || '';
        if (fallbackRes.ok && !fallbackContentType.includes('text/html')) {
          response = fallbackRes;
          finalBaseUrl = fallbackBase;
        } else {
          clearTimeout(timeoutId);
          return Response.json(
            { error: { message: `Upstream models fetch failed: ${err.message}`, code: 502 } },
            { status: 502 }
          );
        }
      } catch {
        clearTimeout(timeoutId);
        return Response.json(
          { error: { message: `Upstream models fetch failed: ${err.message}`, code: 502 } },
          { status: 502 }
        );
      }
    } else {
      clearTimeout(timeoutId);
      return Response.json(
        { error: { message: `Upstream models fetch failed: ${err.message}`, code: 502 } },
        { status: 502 }
      );
    }
  }

  const currentModelsUrl = finalBaseUrl === provider.baseUrl ? initialUrl : `${finalBaseUrl}/models`;
  const retryResult = await retryHtmlResponseWithUserAgentCandidates(response, currentModelsUrl, provider, apiKey, controller.signal);
  response = retryResult.response;
  discoveredUserAgent = retryResult.userAgent;

  clearTimeout(timeoutId);

  if (!response.ok) {
    const message = await readUpstreamError(response);
    return Response.json(
      { error: { message: message || response.statusText, code: response.status } },
      { status: 502 }
    );
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch (err: any) {
    return Response.json(
      { error: { message: `Failed to parse upstream JSON response: ${err.message}`, code: 502 } },
      { status: 502 }
    );
  }

  const models = extractModels(payload);
  return Response.json({
    success: true,
    models,
    count: models.length,
    upstream: finalBaseUrl === provider.baseUrl ? initialUrl : `${finalBaseUrl}/models`,
    baseUrl: finalBaseUrl !== provider.baseUrl ? finalBaseUrl : undefined,
    userAgent: discoveredUserAgent,
  });
}
