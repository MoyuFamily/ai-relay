// ============================================================
// AI API Relay — Error Handling (OpenAI-compatible format)
// ============================================================

/**
 * Standard error types matching OpenAI's error response format.
 * All errors in the relay use this class for consistent handling.
 */
export type ErrorType =
  | 'authentication_error'   // 401 — bad/missing API key
  | 'invalid_request_error'  // 400 — malformed request
  | 'rate_limit_error'       // 429 — quota exceeded
  | 'server_error'           // 500 — internal error
  | 'upstream_error'         // 502 — upstream provider failure
  | 'not_found_error'        // 404 — resource not found
  | 'client_closed_request'; // 499 — client disconnected before response

/**
 * Standardized relay error.
 * toResponse() returns an OpenAI-compatible JSON error body.
 */
export class RelayError extends Error {
  public readonly type: ErrorType;
  public readonly status: number;

  constructor(
    message: string,
    type: ErrorType = 'server_error',
    status: number = 500
  ) {
    super(message);
    this.name = 'RelayError';
    this.type = type;
    this.status = status;
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: {
          message: this.message,
          type: this.type,
          code: this.status,
        },
      }),
      {
        status: this.status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Convenience factories for common error types.
 */
export function authError(message = 'Invalid API key. Provide a valid key in the Authorization header.') {
  return new RelayError(message, 'authentication_error', 401);
}

export function badRequest(message: string) {
  return new RelayError(message, 'invalid_request_error', 400);
}

export function rateLimitError(message: string, retryAfter?: number) {
  return new RelayError(message, 'rate_limit_error', 429);
}

export function upstreamError(message: string) {
  return new RelayError(message, 'upstream_error', 502);
}

export function serverError(message = 'Internal relay error.') {
  return new RelayError(message, 'server_error', 500);
}

/**
 * Standard JSON error response (for route handlers that don't use RelayError).
 */
export function jsonError(status: number, message: string, type: string = 'server_error') {
  return Response.json(
    { error: { message, type, code: status } },
    { status }
  );
}
