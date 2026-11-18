// ============================================================
// AI Relay CLI — Device Login
// ============================================================

import { loadProfile, saveProfile } from './profile.js';

interface LoginOptions {
  device_name: string;
  platform: string;
}

interface SessionCreatedResponse {
  device_code: string;
  device_id: string;
  verification_url: string;
  expires_in: number;
}

interface SessionPollResponse {
  status: 'pending' | 'completed';
  device_id?: string;
  device_token?: string;
}

export async function login(cloudUrl: string, options: LoginOptions) {
  const normalizedUrl = cloudUrl.replace(/\/+$/, '');
  console.log(`🔗 Connecting to ${normalizedUrl}...`);

  const response = await fetch(`${normalizedUrl}/api/local/devices/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_name: options.device_name,
      platform: options.platform,
    }),
  });

  if (!response.ok) {
    console.error('❌ Failed to create device session');
    process.exit(1);
  }

  const { device_code, verification_url, expires_in } =
    (await response.json()) as SessionCreatedResponse;

  console.log('\n📱 Please verify this device in your browser:');
  console.log(`   ${verification_url}`);
  console.log(`\n⏱  Code expires in ${Math.floor(expires_in / 60)} minutes\n`);
  console.log('   Waiting for verification...');

  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < expires_in * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    attempt++;

    const pollResponse = await fetch(
      `${normalizedUrl}/api/local/devices/session?code=${encodeURIComponent(device_code)}`
    );

    if (!pollResponse.ok) {
      if (pollResponse.status === 410) {
        console.error('\n❌ Session expired. Please run login again.');
        process.exit(1);
      }
      continue;
    }

    const result = (await pollResponse.json()) as SessionPollResponse;

    if (result.status === 'completed' && result.device_id && result.device_token) {
      console.log('✅ Device verified!\n');

      const existing = await loadProfile();
      await saveProfile({
        cloudUrl: normalizedUrl,
        deviceId: result.device_id,
        deviceToken: result.device_token,
        deviceName: options.device_name,
        listenHost: existing?.listenHost || '127.0.0.1',
        listenPort: existing?.listenPort || 3147,
        configVersion: existing?.configVersion || 0,
      });

      console.log(`✨ Login successful!`);
      console.log(`   Device ID: ${result.device_id}`);
      console.log(`\n👉 Next: Run "airelay local:start" to start the relay\n`);
      return;
    }

    if (attempt % 5 === 0) {
      console.log(`   Still waiting... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
    }
  }

  console.error('\n❌ Timeout waiting for verification');
  process.exit(1);
}
