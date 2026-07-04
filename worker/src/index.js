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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(KEY_ID_PATTERN);

    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const keyId = match[1];
    const kvKey = `blob:${keyId}`;

    if (request.method === 'GET') {
      const value = await env.SYNC_KV.get(kvKey);
      if (value === null) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(value, { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
        return new Response('Payload Too Large', { status: 413 });
      }

      let envelope;
      try {
        envelope = JSON.parse(body);
      } catch (e) {
        return new Response('Invalid JSON body', { status: 400 });
      }
      if (typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
        return new Response('Invalid envelope shape', { status: 400 });
      }

      await env.SYNC_KV.put(kvKey, body, { expirationTtl: BLOB_TTL_SECONDS });
      return new Response(null, { status: 204 });
    }

    if (request.method === 'DELETE') {
      await env.SYNC_KV.delete(kvKey);
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  },
};
