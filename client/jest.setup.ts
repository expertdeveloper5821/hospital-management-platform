import '@testing-library/jest-dom';

// jsdom (v20, bundled with jest-environment-jsdom) implements `crypto` without
// `crypto.subtle` — the offline-sync layer's client-side AES-256-GCM
// encryption (client/lib/offline/crypto.ts) needs the real WebCrypto
// SubtleCrypto implementation, which Node itself already provides.
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
