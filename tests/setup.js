import { jest } from '@jest/globals';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import chrome from '../mocks/chrome.js';
global.jest = jest;
global.chrome = chrome;

// jsdom's built-in `crypto` only implements getRandomValues, not subtle (Web Crypto).
// Cloud sync's crypto-utils.js needs subtle (HKDF/AES-GCM), so swap in Node's WebCrypto impl.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
