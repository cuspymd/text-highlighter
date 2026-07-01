# text-highlighter-sync Worker

Backend for the cloud sync feature described in
[`arch-docs/cloudflare-kv-based-sync-design.md`](../arch-docs/cloudflare-kv-based-sync-design.md).
It is a ~50 line Worker that stores/returns opaque encrypted blobs in a single
KV namespace — all encryption happens on the extension side
(`shared/crypto-utils.js`); this Worker never sees plaintext highlights or the
user's sync code.

Deployment requires your own Cloudflare account (free tier is enough) and
cannot be done on your behalf — the steps below need to be run locally.

## 1. Install wrangler and log in

```bash
cd worker
npm install -g wrangler   # or: npx wrangler <command> for every step below
wrangler login
```

## 2. Create the KV namespace

```bash
wrangler kv namespace create SYNC_KV
```

This prints an `id`. Copy it into `wrangler.toml`, replacing
`REPLACE_WITH_KV_NAMESPACE_ID`.

## 3. Deploy

```bash
wrangler deploy
```

This prints your Worker's URL, something like:

```
https://text-highlighter-sync.<your-subdomain>.workers.dev
```

## 4. Wire the URL into the extension

Replace the placeholder in **both** of these locations with the URL from
step 3 (no trailing slash):

- [`constants/cloud-sync-config.js`](../constants/cloud-sync-config.js) — `CLOUD_SYNC_ENDPOINT_BASE`
- `host_permissions` in [`manifest.json`](../manifest.json) and [`manifest-firefox.json`](../manifest-firefox.json) — as `https://text-highlighter-sync.<your-subdomain>.workers.dev/*`

Then rebuild (`npm run deploy` / `npm run deploy:firefox`).

## Manual smoke test

```bash
BASE=https://text-highlighter-sync.<your-subdomain>.workers.dev
KEY=$(node -e "console.log(crypto.randomBytes(16).toString('hex'))")

curl -i "$BASE/blob/$KEY"                       # expect 404
curl -i -X PUT "$BASE/blob/$KEY" \
  -H 'Content-Type: application/json' \
  -d '{"v":1,"iv":"AAAA","ciphertext":"AAAA"}'   # expect 204
curl -i "$BASE/blob/$KEY"                       # expect 200 + the JSON above
curl -i -X DELETE "$BASE/blob/$KEY"              # expect 204
```

## Free tier limits to be aware of

- KV: 100k reads/day, 1,000 writes/day (per namespace, shared across all
  users), 1GB storage, 25MB max value size.
- Workers: 100,000 requests/day, 10ms CPU time/invocation.

The extension batches sync into a single blob push per sync cycle (not per
highlight edit) specifically to stay well under the 1,000 writes/day cap —
see the design doc for the reasoning. Rate limiting / abuse protection is
intentionally not implemented in `src/index.js` v1; add it if usage patterns
ever show a need (see "1차 구현 범위와 이후 과제" in the design doc).
