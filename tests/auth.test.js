import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, PASSWORD_ITERATIONS } from '../src/auth.js';

test('hash then verify accepts the right password', async () => {
  const row = await hashPassword('correct horse');
  assert.equal(row.iter, PASSWORD_ITERATIONS);
  assert.equal(await verifyPassword('correct horse', row), true);
});

test('verify rejects a wrong password', async () => {
  const row = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horsf', row), false);
  assert.equal(await verifyPassword('', row), false);
});

test('a new salt gives a different hash for the same password', async () => {
  const a = await hashPassword('same password');
  const b = await hashPassword('same password');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('verify rejects malformed rows', async () => {
  const good = await hashPassword('abcdefgh');
  for (const bad of [null, undefined, 'x', {}, { salt: 'zz', iter: 20000, hash: good.hash },
    { ...good, iter: 0 }, { ...good, iter: 'many' }, { ...good, hash: '' }, { ...good, salt: '' }]) {
    assert.equal(await verifyPassword('abcdefgh', bad), false);
  }
});
