import { describe, it, expect } from 'vitest';
import { buildHeaders } from '../lib/relay/transform';
import { collectPassthroughHeaders } from '../lib/relay/passthrough';

describe('Header Passthrough', () => {
  it('should forward all passthroughHeaders for Anthropic providers', () => {
    const passthroughHeaders = {
      'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-app': 'cli',
      'x-claude-code-session-id': '3e5fcbf1-8eb2-4e20-8ba1-4554f39da697',
      'x-stainless-arch': 'arm64',
      'x-stainless-lang': 'js',
      'x-stainless-os': 'MacOS',
      'x-stainless-package-version': '0.94.0',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': 'v24.3.0',
    };

    const headers = buildHeaders(
      'anthropic',
      'sk-test-key',
      true,
      undefined,
      undefined,
      passthroughHeaders
    );

    // Check that all passthrough headers are included
    expect(headers['anthropic-beta']).toBe('claude-code-20250219,interleaved-thinking-2025-05-14');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-app']).toBe('cli');
    expect(headers['x-claude-code-session-id']).toBe('3e5fcbf1-8eb2-4e20-8ba1-4554f39da697');
    expect(headers['x-stainless-arch']).toBe('arm64');
    expect(headers['x-stainless-lang']).toBe('js');
    expect(headers['x-stainless-os']).toBe('MacOS');
    expect(headers['x-stainless-package-version']).toBe('0.94.0');
    expect(headers['x-stainless-runtime']).toBe('node');
    expect(headers['x-stainless-runtime-version']).toBe('v24.3.0');

    // Check that required headers are still set
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-api-key']).toBe('sk-test-key');
    expect(headers['Accept']).toBe('text/event-stream');
  });

  it('should forward passthroughHeaders for OpenAI providers', () => {
    const passthroughHeaders = {
      'x-stainless-arch': 'arm64',
      'x-custom-header': 'value',
    };

    const headers = buildHeaders(
      'openai',
      'sk-test-key',
      false,
      undefined,
      undefined,
      passthroughHeaders
    );

    // All passthrough headers should be forwarded
    expect(headers['x-stainless-arch']).toBe('arm64');
    expect(headers['x-custom-header']).toBe('value');

    // Check that required headers are still set
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer sk-test-key');
  });

  it('should allow client anthropic-version to override default', () => {
    const passthroughHeaders = {
      'Anthropic-Version': '2024-01-01',
    };

    const headers = buildHeaders(
      'anthropic',
      'sk-test-key',
      false,
      undefined,
      undefined,
      passthroughHeaders
    );

    // Client version should override our default
    expect(new Headers(headers).get('anthropic-version')).toBe('2024-01-01');
    expect(
      Object.keys(headers).filter((name) => name.toLowerCase() === 'anthropic-version')
    ).toHaveLength(1);
  });

  it('should reject relay-managed headers even when passed directly to buildHeaders', () => {
    const headers = buildHeaders(
      'openai',
      'provider-key',
      true,
      'claude-cli/1.2.3',
      undefined,
      {
        'content-type': 'application/xml',
        ACCEPT: 'application/json',
        authorization: 'Bearer client-key',
        'X-API-Key': 'client-key',
        'User-Agent': 'malicious-client/1.0',
        'x-custom-header': 'safe-value',
      }
    );
    const normalized = new Headers(headers);

    expect(normalized.get('content-type')).toBe('application/json');
    expect(normalized.get('accept')).toBe('text/event-stream');
    expect(normalized.get('authorization')).toBe('Bearer provider-key');
    expect(normalized.get('x-api-key')).toBeNull();
    expect(normalized.get('user-agent')).toBe('claude-cli/1.2.3');
    expect(normalized.get('x-custom-header')).toBe('safe-value');
    expect(
      Object.keys(headers).filter((name) => name.toLowerCase() === 'content-type')
    ).toHaveLength(1);
    expect(
      Object.keys(headers).filter((name) => name.toLowerCase() === 'accept')
    ).toHaveLength(1);
    expect(
      Object.keys(headers).filter((name) => name.toLowerCase() === 'user-agent')
    ).toHaveLength(1);
  });

  it('should work without passthroughHeaders', () => {
    const headers = buildHeaders(
      'anthropic',
      'sk-test-key',
      false
    );

    // Should still have required headers
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-api-key']).toBe('sk-test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  describe('collectPassthroughHeaders', () => {
    it('should filter out sensitive authentication headers', () => {
      const mockHeaders = new Map([
        ['authorization', 'Bearer client-secret-key'],
        ['x-api-key', 'client-api-key'],
        ['api-key', 'azure-key'],
        ['x-custom-header', 'safe-value'],
        ['user-agent', 'my-client/1.0'],
        ['content-type', 'application/json'],
        ['accept', 'application/json'],
      ]);

      const result = collectPassthroughHeaders({
        forEach: (callback: (value: string, key: string) => void) => {
          mockHeaders.forEach((value, key) => callback(value, key));
        },
      });

      // Sensitive headers should be blocked
      expect(result['authorization']).toBeUndefined();
      expect(result['x-api-key']).toBeUndefined();
      expect(result['api-key']).toBeUndefined();
      expect(result['content-type']).toBeUndefined();
      expect(result['accept']).toBeUndefined();
      expect(result['user-agent']).toBeUndefined();

      // Safe headers should pass through
      expect(result['x-custom-header']).toBe('safe-value');
    });

    it('should filter out PII/privacy headers', () => {
      const mockHeaders = new Map([
        ['cookie', 'session=abc123'],
        ['set-cookie', 'token=xyz'],
        ['x-forwarded-for', '192.168.1.1'],
        ['x-real-ip', '10.0.0.1'],
        ['forwarded', 'for=192.168.1.1'],
        ['x-forwarded-host', 'example.com'],
        ['x-forwarded-proto', 'https'],
        ['x-app', 'cli'],
      ]);

      const result = collectPassthroughHeaders({
        forEach: (callback: (value: string, key: string) => void) => {
          mockHeaders.forEach((value, key) => callback(value, key));
        },
      });

      // PII headers should be blocked
      expect(result['cookie']).toBeUndefined();
      expect(result['set-cookie']).toBeUndefined();
      expect(result['x-forwarded-for']).toBeUndefined();
      expect(result['x-real-ip']).toBeUndefined();
      expect(result['forwarded']).toBeUndefined();
      expect(result['x-forwarded-host']).toBeUndefined();
      expect(result['x-forwarded-proto']).toBeUndefined();

      // Safe headers should pass through
      expect(result['x-app']).toBe('cli');
    });

    it('should filter out connection/transport headers', () => {
      const mockHeaders = new Map([
        ['host', 'api.example.com'],
        ['content-length', '1234'],
        ['connection', 'keep-alive'],
        ['transfer-encoding', 'chunked'],
        ['upgrade', 'websocket'],
        ['te', 'trailers'],
        ['trailer', 'Expires'],
        ['x-client-version', '1.0'],
      ]);

      const result = collectPassthroughHeaders({
        forEach: (callback: (value: string, key: string) => void) => {
          mockHeaders.forEach((value, key) => callback(value, key));
        },
      });

      // Connection headers should be blocked
      expect(result['host']).toBeUndefined();
      expect(result['content-length']).toBeUndefined();
      expect(result['connection']).toBeUndefined();
      expect(result['transfer-encoding']).toBeUndefined();
      expect(result['upgrade']).toBeUndefined();
      expect(result['te']).toBeUndefined();
      expect(result['trailer']).toBeUndefined();

      // Safe headers should pass through
      expect(result['x-client-version']).toBe('1.0');
    });

    it('should be case-insensitive for blocked headers', () => {
      const mockHeaders = new Map([
        ['Authorization', 'Bearer token'],
        ['X-API-KEY', 'key'],
        ['Cookie', 'session=123'],
        ['HOST', 'example.com'],
        ['Content-Type', 'application/json'],
        ['ACCEPT', 'application/json'],
        ['User-Agent', 'my-client/1.0'],
        ['x-custom-header', 'value'],
      ]);

      const result = collectPassthroughHeaders({
        forEach: (callback: (value: string, key: string) => void) => {
          mockHeaders.forEach((value, key) => callback(value, key));
        },
      });

      // Blocked headers (regardless of case) should not pass through
      expect(result['Authorization']).toBeUndefined();
      expect(result['X-API-KEY']).toBeUndefined();
      expect(result['Cookie']).toBeUndefined();
      expect(result['HOST']).toBeUndefined();
      expect(result['Content-Type']).toBeUndefined();
      expect(result['ACCEPT']).toBeUndefined();
      expect(result['User-Agent']).toBeUndefined();

      // Safe headers should pass through
      expect(result['x-custom-header']).toBe('value');
    });
  });
});
