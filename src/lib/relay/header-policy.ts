// ============================================================
// AI API Relay — Shared Upstream Header Policy
// ============================================================

/**
 * Headers owned by the relay. Clients may supply these on the incoming
 * request, but they are handled through dedicated logic rather than generic
 * passthrough:
 * - authentication is replaced with the selected provider key
 * - content-type and accept are derived from the outgoing payload/stream mode
 * - user-agent is filtered and resolved separately
 *
 * Both the passthrough collector and upstream header builder enforce this set:
 * the collector filters these keys early, while the builder re-checks them as
 * defense-in-depth for ad-hoc callers.
 */
export const RELAY_MANAGED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'content-type',
  'accept',
  'user-agent',
]);
