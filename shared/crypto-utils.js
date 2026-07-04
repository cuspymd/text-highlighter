// Client-side cryptography for cloud sync (see arch-docs/cloudflare-kv-based-sync-design.md).
// The sync code never leaves the device; only the derived keyId (an opaque lookup key)
// and AES-GCM ciphertext are sent to the Worker.

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SYNC_CODE_BYTE_LENGTH = 32; // 256bit
const HKDF_INFO_ENCRYPT = 'th-sync-encrypt-v1';
const HKDF_INFO_KEYID = 'th-sync-keyid-v1';
const GCM_IV_BYTE_LENGTH = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeCrockfordBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_ALPHABET[(value >>> bits) & 31];
    }
  }

  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeCrockfordBase32(input) {
  const normalized = input
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const ch of normalized) {
    const idx = CROCKFORD_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid sync code character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

function groupForDisplay(code, groupSize = 4) {
  const groups = [];
  for (let i = 0; i < code.length; i += groupSize) {
    groups.push(code.slice(i, i + groupSize));
  }
  return groups.join('-');
}

/**
 * Generate a new random sync code (256bit), formatted for display/copying.
 */
export function generateSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(SYNC_CODE_BYTE_LENGTH));
  return groupForDisplay(encodeCrockfordBase32(bytes));
}

function bytesToBase64(bytes) {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive the AES-GCM encryption key and the opaque keyId from a sync code.
 * Both values are deterministic: entering the same code on another device
 * yields identical results without any server round-trip.
 */
export async function deriveSyncKeys(syncCode) {
  const codeBytes = decodeCrockfordBase32(syncCode);
  if (codeBytes.length !== SYNC_CODE_BYTE_LENGTH) {
    throw new Error('Invalid sync code length');
  }

  const baseKey = await crypto.subtle.importKey(
    'raw', codeBytes, 'HKDF', false, ['deriveKey', 'deriveBits']
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: textEncoder.encode(HKDF_INFO_ENCRYPT) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const keyIdBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: textEncoder.encode(HKDF_INFO_KEYID) },
    baseKey,
    128
  );

  return { encryptionKey, keyId: toHex(new Uint8Array(keyIdBits)) };
}

/**
 * Encrypt a JSON-serializable blob into the envelope stored on the server.
 */
export async function encryptBlob(blobObj, encryptionKey) {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTE_LENGTH));
  const plaintext = textEncoder.encode(JSON.stringify(blobObj));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext);

  return {
    v: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt an envelope previously produced by encryptBlob back into the original object.
 */
export async function decryptBlob(envelope, encryptionKey) {
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext);
  return JSON.parse(textDecoder.decode(plaintext));
}
