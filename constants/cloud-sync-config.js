// Base URL of the deployed Cloudflare Worker (see worker/README.md for deployment steps).
// Replace this placeholder with your actual *.workers.dev URL after `wrangler deploy`,
// and update the matching host_permissions entry in manifest.json / manifest-firefox.json.
export const CLOUD_SYNC_ENDPOINT_BASE = 'https://text-highlighter-sync.YOUR_SUBDOMAIN.workers.dev';

export const CLOUD_SYNC_ALARM_NAME = 'cloudSyncAlarm';
export const CLOUD_SYNC_ALARM_PERIOD_MINUTES = 15;
export const CLOUD_SYNC_MAX_BODY_BYTES = 1_000_000;
