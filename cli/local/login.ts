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
    const errBody = await response.text().catch(() => '');
    console.error(`❌ Failed to create device session (HTTP ${response.status})${errBody ? `: ${errBody}` : ''}`);
    process.exit(1);
  }

  const { device_code, verification_url: rawVerificationUrl, expires_in } =
    (await response.json()) as SessionCreatedResponse;

  // If the server sits behind a reverse proxy and returned an internal origin
  // (e.g. http://0.0.0.0:3000 or http://localhost:3000), rewrite it using the
  // user-supplied cloudUrl so the browser link actually works.
  let verification_url = rawVerificationUrl;
  try {
    const parsedVerify = new URL(rawVerificationUrl);
    const parsedCloud = new URL(normalizedUrl);
    const isInternalHost =
      parsedVerify.hostname === '0.0.0.0' ||
      parsedVerify.hostname === '127.0.0.1' ||
      parsedVerify.hostname === 'localhost';
    const isCloudPublic =
      parsedCloud.hostname !== '0.0.0.0' &&
      parsedCloud.hostname !== '127.0.0.1' &&
      parsedCloud.hostname !== 'localhost';
    if (isInternalHost && isCloudPublic) {
      verification_url = `${normalizedUrl}${parsedVerify.pathname}${parsedVerify.search}`;
    }
  } catch {
    // Keep server-provided URL if parsing fails
  }

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
