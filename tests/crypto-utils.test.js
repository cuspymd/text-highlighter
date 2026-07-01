import {
  generateSyncCode,
  deriveSyncKeys,
  encryptBlob,
  decryptBlob,
} from '../shared/crypto-utils.js';

describe('crypto-utils', () => {
  test('generateSyncCode produces a grouped, uppercase code', () => {
    const code = generateSyncCode();
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){12}$/);
  });

  test('generateSyncCode produces unique codes', () => {
    const a = generateSyncCode();
    const b = generateSyncCode();
    expect(a).not.toBe(b);
  });

  test('deriveSyncKeys is deterministic for the same code', async () => {
    const code = generateSyncCode();
    const first = await deriveSyncKeys(code);
    const second = await deriveSyncKeys(code);
    expect(first.keyId).toBe(second.keyId);
    expect(first.keyId).toMatch(/^[a-f0-9]{32}$/);
  });

  test('deriveSyncKeys yields different keyId for different codes', async () => {
    const a = await deriveSyncKeys(generateSyncCode());
    const b = await deriveSyncKeys(generateSyncCode());
    expect(a.keyId).not.toBe(b.keyId);
  });

  test('deriveSyncKeys tolerates lowercase input and stray whitespace', async () => {
    const code = generateSyncCode();
    const messy = code.toLowerCase().replace(/-/g, ' ');
    const canonical = await deriveSyncKeys(code);
    const fromMessy = await deriveSyncKeys(messy);
    expect(fromMessy.keyId).toBe(canonical.keyId);
  });

  test('encryptBlob/decryptBlob round-trips arbitrary JSON', async () => {
    const code = generateSyncCode();
    const { encryptionKey } = await deriveSyncKeys(code);
    const original = { version: 1, pages: { 'https://example.com': { highlights: [{ groupId: 'a' }] } } };

    const envelope = await encryptBlob(original, encryptionKey);
    expect(envelope.v).toBe(1);
    expect(typeof envelope.iv).toBe('string');
    expect(typeof envelope.ciphertext).toBe('string');

    const decrypted = await decryptBlob(envelope, encryptionKey);
    expect(decrypted).toEqual(original);
  });

  test('decryptBlob fails with the wrong key', async () => {
    const { encryptionKey: keyA } = await deriveSyncKeys(generateSyncCode());
    const { encryptionKey: keyB } = await deriveSyncKeys(generateSyncCode());

    const envelope = await encryptBlob({ hello: 'world' }, keyA);
    await expect(decryptBlob(envelope, keyB)).rejects.toThrow();
  });

  test('two encryptions of the same blob use different IVs/ciphertext', async () => {
    const { encryptionKey } = await deriveSyncKeys(generateSyncCode());
    const blob = { a: 1 };
    const e1 = await encryptBlob(blob, encryptionKey);
    const e2 = await encryptBlob(blob, encryptionKey);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
  });
});
