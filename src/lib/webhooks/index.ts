// ============================================================
// AI API Relay — Webhook Sender Service
// ============================================================
// High-level service that ties together:
//   - Webhook settings (from KV)
//   - Platform adapters (format + dispatch)
//   - Usage data (for daily reports & alerts)
// ============================================================

import type { WebhookSettings, WebhookResult, DailyReportData, AlertData } from './types';
import type { WebhookMessage } from './adapters/types';
import { dispatchAll } from './adapters';
import { getWebhookSettings } from '../admin/admin-config';

export { dispatchWebhook, dispatchAll, getAdapter } from './adapters';
export * from './types';
export type { WebhookAdapter, WebhookMessage } from './adapters';

/**
 * Send a daily report to all enabled webhooks.
 * Returns results for each webhook.
 */
export async function sendDailyReport(report: DailyReportData): Promise<WebhookResult[]> {
  const settings = await getWebhookSettings();
  if (settings.webhooks.length === 0) return [];

  const msg: WebhookMessage = {
    type: 'daily_report',
    title: `AI-Relay 日报 (${report.date})`,
    data: report,
  };

  return dispatchAll(settings.webhooks, msg);
}

/**
 * Send a quota alert to all enabled webhooks.
 * Returns results for each webhook.
 */
export async function sendQuotaAlert(alert: AlertData): Promise<WebhookResult[]> {
  const settings = await getWebhookSettings();
  if (settings.webhooks.length === 0) return [];

  const msg: WebhookMessage = {
    type: 'alert',
    title: `AI-Relay 配额告警 — ${alert.provider}`,
    data: alert,
  };

  return dispatchAll(settings.webhooks, msg);
}

/**
 * Send a test message to a specific webhook config.
 * Returns the result.
 */
export async function sendTestMessage(
  webhookConfig: import('./types').WebhookConfig,
): Promise<WebhookResult> {
  const testReport: DailyReportData = {
    date: new Date().toISOString().slice(0, 10),
    totalRequests: 42,
    totalTokens: 123456,
    promptTokens: 80000,
    completionTokens: 43456,
    providers: {
      'test-provider': {
        requests: 42,
        tokens: 123456,
        promptTokens: 80000,
        completionTokens: 43456,
      },
    },
    topModels: [{ model: 'gpt-6-luna', count: 42 }],
  };

  const msg: WebhookMessage = {
    type: 'daily_report',
    title: 'AI-Relay Webhook 测试消息',
    data: testReport,
  };

  const { dispatchWebhook } = await import('./adapters');
  return dispatchWebhook(webhookConfig, msg);
}
