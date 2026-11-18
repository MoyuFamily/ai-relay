const MAX_INLINE_IMAGE_BYTES = 1024 * 1024; // 1MB

function checkBase64Bytes(base64Data: string): { valid: boolean; error?: string } {
  const approximateBytes = Math.ceil((base64Data.length * 3) / 4);
  if (approximateBytes > MAX_INLINE_IMAGE_BYTES) {
    const sizeInMB = (approximateBytes / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Base64 image size exceeds the limit of 1MB (current size: ${sizeInMB}MB).`,
    };
  }
  return { valid: true };
}

function checkDataUrl(url: string): { valid: boolean; error?: string } {
  if (!url.startsWith('data:')) return { valid: true };
  const commaIdx = url.indexOf(',');
  if (commaIdx === -1) return { valid: true };
  return checkBase64Bytes(url.slice(commaIdx + 1));
}

/**
 * Validate base64 image sizes in request body across OpenAI Chat Completions,
 * Anthropic Messages, and OpenAI Responses API formats.
 * If any inline image exceeds 1MB, returns validation result with error.
 */
export function validateBase64ImageSizes(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') {
    return { valid: true };
  }

  // OpenAI Chat Completions & Anthropic Messages (`messages` array)
  if (Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (!msg || !Array.isArray(msg.content)) continue;
      for (let j = 0; j < msg.content.length; j++) {
        const part = msg.content[j];
        if (!part || typeof part !== 'object') continue;

        // OpenAI format: { type: 'image_url', image_url: { url: 'data:...' } }
        if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
          const check = checkDataUrl(part.image_url.url);
          if (!check.valid) return check;
        }

        // Anthropic format: { type: 'image', source: { type: 'base64', data: '...' } }
        if (part.type === 'image' && typeof part.source?.data === 'string') {
          const check = checkBase64Bytes(part.source.data);
          if (!check.valid) return check;
        }
      }
    }
  }

  // OpenAI Responses API (`input` array)
  if (Array.isArray(body.input)) {
    for (let i = 0; i < body.input.length; i++) {
      const item = body.input[i];
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'input_image' && typeof item.image_url === 'string') {
        const check = checkDataUrl(item.image_url);
        if (!check.valid) return check;
      }
      if (Array.isArray(item.content)) {
        for (let j = 0; j < item.content.length; j++) {
          const part = item.content[j];
          if (!part || typeof part !== 'object') continue;
          const imgUrl =
            typeof part.image_url === 'string'
              ? part.image_url
              : typeof part.image_url?.url === 'string'
                ? part.image_url.url
                : null;
          if ((part.type === 'input_image' || part.type === 'image_url') && imgUrl) {
            const check = checkDataUrl(imgUrl);
            if (!check.valid) return check;
          }
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Default cap for the total request-size guard (10MB). Generous enough
 * for legitimate multi-modal requests (several images + text) while bounding
 * oversized payloads before memory/CPU exhaustion.
 */
const DEFAULT_MAX_REQUEST_BYTES = 10 * 1024 * 1024;

function maxRequestBytes(): number {
  const raw = process.env.RELAY_MAX_REQUEST_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_REQUEST_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_REQUEST_BYTES;
  return parsed; // 0 disables the cap
}

/**
 * Cheap O(1) total request-size guard for Cloudflare Free and pre-flight header checks.
 *
 * The precise per-image base64 scan (validateBase64ImageSizes) is O(body)
 * CPU, which CF Free's ~10ms budget can't afford on large requests. This
 * preserves equivalent abuse protection at constant cost by capping the
 * whole request size instead of scanning each image.
 * Set RELAY_MAX_REQUEST_BYTES=0 to disable.
 */
export function validateRequestSize(rawByteLength: number): { valid: boolean; error?: string } {
  const cap = maxRequestBytes();
  if (cap > 0 && rawByteLength > cap) {
    const sizeInMB = (rawByteLength / (1024 * 1024)).toFixed(2);
    const capInMB = (cap / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Request body size (${sizeInMB}MB) exceeds the limit of ${capInMB}MB.`,
    };
  }
  return { valid: true };
}

/**
 * Pre-parse Content-Length check so oversized bodies are rejected before
 * buffering `request.text()` / `request.json()` into isolate memory.
 */
export function validateContentLengthHeader(headers: Pick<Headers, 'get'>): { valid: boolean; error?: string } {
  const rawLen = headers.get('content-length');
  if (!rawLen) return { valid: true };
  const parsed = Number(rawLen);
  if (!Number.isFinite(parsed) || parsed <= 0) return { valid: true };
  return validateRequestSize(parsed);
}
