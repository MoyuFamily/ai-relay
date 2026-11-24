// ============================================================
// AI API Relay — Middleware
// Handles CORS for all API routes across Vercel, CF Workers & Node
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-API-Key',
  'X-Request-ID',
  'Anthropic-Version',
  'Anthropic-Beta',
  'Anthropic-Dangerous-Direct-Browser-Access',
  'X-Cron-Secret',
].join(', ');

/** CORS headers to add to allowed responses */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': DEFAULT_ALLOW_HEADERS,
  'Access-Control-Expose-Headers': 'X-Relay-Provider, X-Relay-Key, X-Request-ID, Retry-After',
  'Access-Control-Max-Age': '86400',
};

/**
 * Read allowed origins dynamically per request so runtime-bound env vars on
 * Cloudflare Workers / OpenNext are always respected, and empty strings fall
 * back cleanly to `['*']`.
 */
function getAllowedOrigins(): string[] {
  const raw = process.env.RELAY_ALLOWED_ORIGINS || process.env.CORS_ORIGINS;
  if (!raw || !raw.trim()) return ['*'];
  const parsed = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ['*'];
}

export function middleware(request: NextRequest) {
  const allowedOrigins = getAllowedOrigins();
  const wildcard = allowedOrigins.includes('*');
  const requestOrigin = request.headers.get('origin');
  const isAllowed = wildcard || (!!requestOrigin && allowedOrigins.includes(requestOrigin));

  // Handle CORS preflight (OPTIONS request)
  if (request.method === 'OPTIONS') {
    if (!isAllowed) {
      return new NextResponse(null, {
        status: 403,
        headers: { Vary: 'Origin' },
      });
    }
    const requestedHeaders = request.headers.get('access-control-request-headers');
    const responseHeaders: Record<string, string> = {
      ...CORS_HEADERS,
      'Access-Control-Allow-Origin': wildcard ? (requestOrigin || '*') : requestOrigin!,
    };
    if (requestedHeaders) {
      responseHeaders['Access-Control-Allow-Headers'] = `${DEFAULT_ALLOW_HEADERS}, ${requestedHeaders}`;
    }
    if (!wildcard || requestOrigin) {
      responseHeaders['Vary'] = 'Origin';
    }
    return new NextResponse(null, {
      status: 204,
      headers: responseHeaders,
    });
  }

  // Continue with the request and add CORS headers to response when allowed
  const response = NextResponse.next();

  if (isAllowed) {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    response.headers.set(
      'Access-Control-Allow-Origin',
      wildcard ? (requestOrigin || '*') : requestOrigin!
    );
    if (!wildcard || requestOrigin) {
      response.headers.append('Vary', 'Origin');
    }
  }

  return response;
}

// Match all API and v1 routes
export const config = {
  matcher: [
    '/api/:path*',
    '/v1/:path*',
    '/health',
  ],
};
