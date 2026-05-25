import { describe, expect, it, vi, beforeEach } from 'vitest';
import { __requestLogStoreForTests, listRequestLogs, recordRequestLog, sanitizeDiagnosticText } from '../lib/observability/request-logs';

describe('request log observability', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    __requestLogStoreForTests.clear();
  });

  it('sanitizes bearer tokens and sk-style secrets from diagnostics', () => {
    const input = 'Authorization: Bearer sk-live-secret-token-1234567890 failed with api_key=sk-another-secret-abcdef';
    const output = sanitizeDiagnosticText(input);

    expect(output).not.toContain('sk-live-secret-token');
    expect(output).not.toContain('sk-another-secret');
    expect(output).toContain('[REDACTED]');
  });

  it('records and filters request logs with in-memory fallback when KV is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('ENABLE_REQUEST_LOGS', 'true');

    await recordRequestLog({
      traceId: 'trace_success',
      timestamp: '2026-05-25T00:00:00.000Z',
      apiKeyHash: 'abcd1234',
      model: 'gpt-4o-mini',
      provider: 'openai',
      status: 'success',
      httpStatus: 200,
      latencyMs: 321,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      isStream: false,
    });
    await recordRequestLog({
      traceId: 'trace_error',
      timestamp: '2026-05-25T00:01:00.000Z',
      apiKeyHash: 'efgh5678',
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      status: 'error',
      httpStatus: 401,
      latencyMs: 99,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      isStream: false,
      errorType: 'authentication_error',
      errorMessage: 'Bearer sk-bad-secret was rejected',
    });

    const errors = await listRequestLogs({ status: 'error' });

    expect(errors.degraded).toBe(true);
    expect(errors.items).toHaveLength(1);
    expect(errors.items[0].traceId).toBe('trace_error');
    expect(errors.items[0].errorMessage).not.toContain('sk-bad-secret');
  });
});
