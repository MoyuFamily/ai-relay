// ============================================================
// AI API Relay — In-Memory Request Log Store
// ============================================================
// Lightweight in-memory store for dev/test or when no persistent backend
// is available. Logs live only in the current process; restarting clears them.

import type { RequestLogStore, RequestLogEntry, RequestLogFilters } from './types';
import { getCachedRuntimeSettingsSync } from '@/lib/admin/runtime-settings';

const DEFAULT_MAX_ENTRIES = 50;
const MAX_ENTRIES_HARD_CAP = 500;

export class MemoryRequestLogStore implements RequestLogStore {
  readonly source = 'memory' as const;
  private logs: RequestLogEntry[] = [];
  private captureEnabled = false;
  private captureTimer: NodeJS.Timeout | null = null;

  private getMaxEntries(): number {
    const configured = getCachedRuntimeSettingsSync().requestLogsMaxEntries;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 1) {
      return Math.min(Math.floor(configured), MAX_ENTRIES_HARD_CAP);
    }
    const userMax = parseInt(process.env.REQUEST_LOGS_MAX_ENTRIES || '', 10);
    return isNaN(userMax)
      ? DEFAULT_MAX_ENTRIES
      : Math.min(userMax, MAX_ENTRIES_HARD_CAP);
  }

  async append(log: RequestLogEntry): Promise<void> {
    if (!this.captureEnabled) return;
    this.logs.unshift(log); // newest first
    const max = this.getMaxEntries();
    if (this.logs.length > max) {
      this.logs.length = max;
    }
  }

  async list(filters?: RequestLogFilters): Promise<RequestLogEntry[]> {
    let result = [...this.logs];

    if (filters?.status && filters.status !== 'all') {
      result = result.filter((log) => log.status === filters.status);
    }
    if (filters?.provider) {
      result = result.filter((log) => log.provider === filters.provider);
    }
    if (filters?.limit && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  async clear(): Promise<void> {
    this.logs = [];
  }

  async isCaptureEnabled(): Promise<boolean> {
    return this.captureEnabled;
  }

  async enableCapture(ttlSeconds: number): Promise<void> {
    this.captureEnabled = true;
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
    }
    this.captureTimer = setTimeout(() => {
      this.captureEnabled = false;
      this.captureTimer = null;
    }, ttlSeconds * 1000);
  }

  // Test helper
  __reset(): void {
    this.logs = [];
    this.captureEnabled = false;
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
  }
}
