import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'node:util';
import { webcrypto } from 'node:crypto';
import chrome from '../mocks/chrome.js';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
// jsdom may define window.crypto without subtle; override it with Node's webcrypto
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});
global.jest = jest;
global.chrome = chrome;
