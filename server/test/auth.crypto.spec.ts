import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  hashToken,
  isValidPkceVerifier,
  pkceChallenge,
  randomOpaqueToken,
  safeStringEqual,
  verifyPassword,
} from '../src/modules/auth/auth.crypto';

test('hashes and verifies a password without storing it', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes('correct horse'), false);
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
});

test('generates opaque tokens and stable token hashes', () => {
  const token = randomOpaqueToken();
  assert.ok(token.length >= 43);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(`${token}x`));
});

test('validates PKCE S256 values', () => {
  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  assert.equal(isValidPkceVerifier(verifier), true);
  assert.equal(isValidPkceVerifier('short'), false);
  assert.equal(pkceChallenge(verifier).length, 43);
  assert.equal(safeStringEqual(pkceChallenge(verifier), pkceChallenge(verifier)), true);
});
