import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, chainHash, GENESIS_HASH } from './canonical';
import { hashPassword, verifyPassword, passwordProblems, DUMMY_HASH } from './password';
import { can, Permission } from './rbac';
import { HttpProblem, problemResponse } from './problem';

test('canonical JSON sorts keys at every depth and drops undefined', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test('canonical JSON rejects non-finite numbers', () => {
  assert.throws(() => canonicalJson({ n: Number.NaN }), TypeError);
});

test('chain hash depends on the previous hash and on every field', () => {
  const h1 = chainHash(GENESIS_HASH, { seq: 1, action: 'a' });
  assert.equal(h1.length, 32);
  assert.notDeepEqual(chainHash(h1, { seq: 2, action: 'a' }), chainHash(GENESIS_HASH, { seq: 2, action: 'a' }));
  assert.notDeepEqual(chainHash(GENESIS_HASH, { seq: 1, action: 'b' }), h1);
});

test('password hash round-trips and rejects wrong passwords', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterz', h), false);
  assert.equal(await verifyPassword('anything', DUMMY_HASH), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('password policy', () => {
  assert.equal(passwordProblems('short').length, 1);
  assert.equal(passwordProblems('aaaaaaaaaaaa').length, 1);
  assert.deepEqual(passwordProblems('a-long-enough-pass'), []);
});

test('RBAC: dispatchers cannot manage members or read audit', () => {
  assert.equal(can('owner', Permission.MembersManage), true);
  assert.equal(can('owner', Permission.AuditRead), true);
  assert.equal(can('dispatcher', Permission.MembersManage), false);
  assert.equal(can('dispatcher', Permission.AuditRead), false);
  assert.equal(can('dispatcher', Permission.TenantRead), true);
});

test('problem+json carries code, status and request id', async () => {
  const res = problemResponse(new HttpProblem('RATE_LIMITED', { headers: { 'retry-after': '60' } }), 'req_1');
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assert.equal(res.headers.get('retry-after'), '60');
  const body = await res.json();
  assert.equal(body.code, 'RATE_LIMITED');
  assert.equal(body.request_id, 'req_1');
  assert.equal(body.type, 'https://docs.dropdesk.app/problems/rate-limited');
});
