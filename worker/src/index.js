// Cloudflare Worker backing the "cloud sync" feature (see
// arch-docs/cloudflare-kv-based-sync-design.md). This is a thin, unauthenticated
// proxy over a single KV namespace: the extension client encrypts everything
// client-side (shared/crypto-utils.js) before it ever reaches here, and the
// keyId in the URL path *is* the access token (derived from the user's own
// sync code, never sent to or known by this Worker).
//
// Deployment: see worker/README.md. Requires only a Cloudflare free-tier
// account and `wrangler` — no other services.

const MAX_BODY_BYTES = 1_000_000; // Basic guardrail against accidental huge payloads, not abuse defense.
const KEY_ID_PATTERN = /^\/blob\/([a-f0-9]{32})$/;
// Every successful PUT refreshes this TTL, so any device that's still syncing keeps its
// blob alive indefinitely. Only truly abandoned codes (no device pushes for a full year)
// age out, reclaiming free-tier KV storage without any explicit cleanup job.
const BLOB_TTL_SECONDS = 60 * 60 * 24 * 365;

// The keyId in the URL *is* the access token (see file header) - there's no cookie or
// origin-based auth to protect, so a permissive CORS policy is safe. It's also required:
// some browsers (e.g. Firefox for Android) enforce CORS on extension background fetches
// even when host_permissions would normally exempt them, so every response - including
// errors and preflight - needs these headers or the client never sees the real status.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function textResponse(body, status) {
  return new Response(body, { status, headers: CORS_HEADERS });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(KEY_ID_PATTERN);

    if (!match) {
      return textResponse('Not Found', 404);
    }

    const keyId = match[1];
    const kvKey = `blob:${keyId}`;

    if (request.method === 'GET') {
      const value = await env.SYNC_KV.get(kvKey);
      if (value === null) {
        return textResponse('Not Found', 404);
      }
      return new Response(value, { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
        return textResponse('Payload Too Large', 413);
      }

      let envelope;
      try {
        envelope = JSON.parse(body);
      } catch (e) {
        return textResponse('Invalid JSON body', 400);
      }
      if (typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
        return textResponse('Invalid envelope shape', 400);
      }

      await env.SYNC_KV.put(kvKey, body, { expirationTtl: BLOB_TTL_SECONDS });
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'DELETE') {
      await env.SYNC_KV.delete(kvKey);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  },
};
