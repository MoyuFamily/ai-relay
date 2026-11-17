// ============================================================
// AI Relay API — Local Config Version
// ============================================================

import { NextRequest } from 'next/server';
import { requireLocalSyncAuth } from '@/lib/local/device-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authErr = await requireLocalSyncAuth(request);
  if (authErr) return authErr;

  try {
    const { getDefaultConfigStore } = await import('@/lib/config-store');
    const store = getDefaultConfigStore();
    const version = await store.getConfigVersion();

    return Response.json(
      { version },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: any) {
    // Don't leak internal error details to client
    console.error('[config/version] Error:', error);
    return Response.json(
      { error: { message: 'Failed to retrieve config version', type: 'internal_error' } },
      { status: 500 }
    );
  }
}
