// ============================================================
// AI API Relay — First-Time Bootstrap API (/api/admin/bootstrap)
// ============================================================
// GET  /api/admin/bootstrap  — Safe status check (never exposes keys)
// POST /api/admin/bootstrap  — One-time initialization of RELAY_API_KEY

import { NextRequest } from 'next/server';
import {
  BootstrapError,
  getBootstrapStatus,
  initializeBootstrapApiKey,
} from '@/lib/admin/bootstrap-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getBootstrapStatus();
    return Response.json(status, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    return Response.json(
      {
        error: {
          message: err instanceof Error ? err.message : 'Failed to check bootstrap status',
          code: 500,
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let apiKeyInput: string | undefined;
  try {
    const text = await request.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { apiKey?: unknown };
      if (body.apiKey !== undefined && body.apiKey !== null && body.apiKey !== '') {
        if (typeof body.apiKey !== 'string') {
          return Response.json(
            { error: { message: 'apiKey must be a string.', type: 'invalid_request', code: 400 } },
            { status: 400 }
          );
        }
        apiKeyInput = body.apiKey;
      }
    }
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body.', type: 'invalid_request', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const record = await initializeBootstrapApiKey(apiKeyInput);
    return Response.json(
      {
        initialized: true,
        source: 'storage',
        apiKey: record.apiKey,
        createdAt: record.createdAt,
      },
      {
        status: 201,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    if (err instanceof BootstrapError) {
      return Response.json(
        {
          error: {
            message: err.message,
            type: err.type,
            code: err.code,
          },
        },
        {
          status: err.code,
          headers: {
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    return Response.json(
      {
        error: {
          message: err instanceof Error ? err.message : 'Bootstrap initialization failed',
          code: 500,
        },
      },
      { status: 500 }
    );
  }
}
