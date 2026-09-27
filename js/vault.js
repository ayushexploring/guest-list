/* ============================================================
   GUEST LIST - PASSCODE LOCK
   Encrypts the GitHub token with the family passcode
   (PBKDF2-SHA256 -> AES-GCM, browser built-in WebCrypto), so
   only the locked version is ever published.
   ============================================================ */

const Vault = (function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- bytes <-> base64 ---------- */
  function toB64(bytes) {
    let s = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
    return btoa(s);
  }

  function fromB64(b64) {
    const s = atob(b64.replace(/\s/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* ---------- passcode -> AES key ---------- */
  async function deriveKey(passcode, salt, iterations) {
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(passcode.trim().normalize('NFC')), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(secret, passcode, iterations) {
    iterations = iterations || 600000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(passcode, salt, iterations);
    const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(secret));
    return { v: 1, iter: iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
  }

  /* Throws if the passcode is wrong (AES-GCM authentication fails). */
  async function decrypt(vault, passcode) {
    const key = await deriveKey(passcode, fromB64(vault.salt), vault.iter);
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.ct));
    return dec.decode(pt);
  }

  return { encrypt: encrypt, decrypt: decrypt, toB64: toB64, fromB64: fromB64 };
})();
