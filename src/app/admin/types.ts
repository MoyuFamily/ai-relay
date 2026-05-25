// ============================================================
// AI Relay Admin — Shared Type Definitions
// ============================================================

export interface ProviderInfo {
  name: string;
  id: string;
  keyCount: number;
  availableKeys: number;
  configured: boolean;
  modelPrefixes: string[];
  models?: Array<{
    id: string;
    displayName: string;
    contextWindow: number;
    maxOutput?: number;
    supportsStream?: boolean;
    supportsVision?: boolean;
    supportsTools?: boolean;
    pricing?: {
      input: number;
      output: number;
    };
  }>;
  isCustom?: boolean;
  baseUrl?: string;
  headerFormat?: 'openai' | 'anthropic' | 'azure';
  envKeyField?: string;
  errors?: Record<string, number>;
  keyErrors?: Array<{
    keyHash: string;
    errors: Record<string, { count: number; reason: string }>;
  }>;
}

export interface AdminData {
  status: string;
  timestamp: string;
  providers: ProviderInfo[];
  usage: {
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }>;
  };
  quota: {
    daily: { used: number; limit: number | string };
    monthly: { used: number; limit: number | string };
    allowed: boolean;
    isOverride: boolean;
  };
  config: {
    dailyLimit: number | null;
    monthlyLimit: number | null;
    customDailyLimit?: number | null;
    customMonthlyLimit?: number | null;
  };
}

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  platform: 'wecom' | 'feishu' | 'dingtalk' | 'slack' | 'generic';
  enabled: boolean;
  template?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertThreshold {
  provider: string;
  dailyRequestLimit?: number;
  dailyTokenLimit?: number;
}

export interface WebhookSettings {
  webhooks: WebhookConfig[];
  alertThresholds: AlertThreshold[];
  reportTime: string;
  reportTimezone: string;
}

export interface PriorityRule {
  id: string;
  name: string;
  enabled: boolean;
  modelPattern: string;
  providerOrder: string[];
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PriorityRuleConflict {
  type: 'overlap' | 'duplicate' | 'shadow';
  severity: 'warning' | 'error';
  ruleIds: [string, string];
  ruleNames: [string, string];
  sampleModel: string;
  matchedModels: string[];
  message: string;
}
