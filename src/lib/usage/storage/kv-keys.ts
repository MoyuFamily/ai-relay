// ============================================================
// AI API Relay — KV key names for usage storage
// ============================================================

export const kvKeys = {
  usageDaily: (date: string) => `usage:daily:${date}`,
  usageProviderDaily: (provider: string, date: string) => `usage:provider:${provider}:daily:${date}`,
  quotaDaily: (date: string) => `quota:daily:${date}`,
  quotaMonthly: (month: string) => `quota:monthly:${month}`,
  errorProviderDaily: (provider: string, date: string) => `error:${provider}:${date}`,
  errorKeyIndex: (date: string) => `error:keys:${date}`,

  // Legacy per-key usage keys. Kept for compatibility and optional diagnostics.
  legacyKeyDaily: (keyHash: string, date: string) => `usage:${keyHash}:daily:${date}`,
  legacyKeyTotal: (keyHash: string) => `usage:${keyHash}:total`,
  legacyErrorKeyDaily: (keyHash: string, date: string) => `error:key:${keyHash}:${date}`,
  requestLogsIndex: () => 'request:logs:index',
  requestLog: (traceId: string) => `request:log:${traceId}`,
} as const;
