import { NextRequest } from 'next/server';
import { requireAdminAuth, getEffectiveRelayApiKeys, getAllManagedKeys, getRuntimeSettings } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import { hashKey } from '@/lib/relay';
import { buildCcSwitchExport, CC_SWITCH_APPS, isCcSwitchApp } from '@/lib/admin/cc-switch-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getRelayBaseUrl(request: NextRequest): Promise<string> {
  const url = new URL(request.url);
  const runtimeDeployUrl = (await getRuntimeSettings()).deployUrl?.trim();
  const configured = runtimeDeployUrl || process.env.DEPLOY_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL;
  if (configured) {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return withProtocol.replace(/\/+$/, '');
  }
  return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
}

function getEnvKeys(field?: string): string[] {
  if (!field) return [];
  return (process.env[field] || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const rawMode = url.searchParams.get('mode');
  const mode = rawMode === 'provider' || rawMode === 'providers' ? rawMode : 'relay';
  const app = url.searchParams.get('app');
  const providerId = url.searchParams.get('providerId') || undefined;
  const keyHash = url.searchParams.get('keyHash') || undefined;

  try {
    if ((mode === 'relay' || mode === 'provider') && !isCcSwitchApp(app)) {
      return Response.json(
        { error: { message: 'A valid app is required. Allowed: claude, claude-desktop, codex, hermes, openclaw.', code: 400 } },
        { status: 400 }
      );
    }

    const providers = await getAllProviders(true);
    const relayKeys = await getEffectiveRelayApiKeys();
    const providerKeys = mode !== 'relay' ? await getAllManagedKeys() : {};
    if (mode !== 'relay') {
      for (const [providerId, provider] of Object.entries(providers)) {
        if (providerKeys[providerId]?.length) continue;
        const envKeys = getEnvKeys(provider.envKeyField);
        if (envKeys.length > 0) {
          providerKeys[providerId] = envKeys;
        }
      }
    }
    const keyHashes = Object.fromEntries(
      Object.entries(providerKeys).map(([id, keys]) => [id, keys.map(hashKey)])
    );

    if (mode === 'relay' && relayKeys.length === 0) {
      return Response.json(
        { error: { message: 'RELAY_API_KEY is not configured; cannot export AI Relay to CC Switch.', code: 400 } },
        { status: 400 }
      );
    }

    const payload = buildCcSwitchExport({
      mode,
      app: isCcSwitchApp(app) ? app : undefined,
      relayBaseUrl: await getRelayBaseUrl(request),
      relayApiKey: relayKeys[0] || '',
      providers,
      providerKeys,
      keyHashes,
      providerId,
      keyHash,
    });

    return Response.json({
      ...payload,
      apps: CC_SWITCH_APPS,
      keySummaries: Object.fromEntries(
        Object.entries(keyHashes).map(([id, hashes]) => [id, hashes.map((hash, index) => ({ hash, index }))])
      ),
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'Failed to export CC Switch configuration', code: 500 } },
      { status: 500 }
    );
  }
}
