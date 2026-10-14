// Sprint 1 acceptance tests. Real PostgreSQL; the API connects as dropdesk_app (non-owner, RLS-bound).
// DATABASE_OWNER_URL must point at a disposable database: the suite drops and recreates schema `app`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApi, createPool, migrate, type Db } from '../src/index';

const OWNER_URL = process.env.DATABASE_OWNER_URL ?? 'postgres://dd_owner:dd_owner@localhost:5432/dropdesk_test';
const APP_URL = process.env.DATABASE_URL ?? 'postgres://dropdesk_app:dropdesk_app@localhost:5432/dropdesk_test';
const ORIGIN = 'http://localhost:3000';

let owner: pg.Client;
let db: Db;
let handle: (req: Request) => Promise<Response>;

before(async () => {
  owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  await owner.query('drop schema if exists app cascade; drop table if exists public.schema_migrations');
  await migrate(OWNER_URL);
  await owner.query(`alter role dropdesk_app login password 'dropdesk_app'`);
  db = createPool(APP_URL);
  handle = createApi({ db, allowedOrigins: [ORIGIN], secureCookies: false, log: () => {} });
});

after(async () => {
  await db.end();
  await owner.end();
});

// --- helpers ------------------------------------------------------------------------------------
interface CallOpts { body?: unknown; cookie?: string | null; idem?: string; origin?: string | null }
async function call(method: string, path: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.idem) headers['idempotency-key'] = o.idem;
  if (o.origin !== null && method !== 'GET') headers.origin = o.origin ?? ORIGIN;
  const res = await handle(new Request(`${ORIGIN}${path}`, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
const cookieOf = (res: { headers: Headers }) => res.headers.get('set-cookie')!.split(';')[0]!;
let n = 0;
async function newUser(label: string) {
  const email = `${label}.${++n}@example.ng`;
  const password = 'a-strong-passphrase';
  assert.equal((await call('POST', '/v1/auth/signup', { body: { email, display_name: label, password } })).status, 201);
  const login = await call('POST', '/v1/auth/login', { body: { email, password } });
  assert.equal(login.status, 200);
  return { email, password, cookie: cookieOf(login) };
}
async function newTenant(cookie: string, slug: string) {
  const r = await call('POST', '/v1/tenants', { cookie, idem: `create-${slug}`, body: { slug, name: `Tenant ${slug}` } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call('POST', '/v1/session/tenant', { cookie, body: { tenant_id: r.body.id } })).status, 200);
  return r.body.id as string;
}
/** Raw SQL as the app role under a given context, to prove isolation below the API too. */
async function asApp<T>(ctx: { userId?: string; tenantId?: string }, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`, [ctx.userId ?? '', ctx.tenantId ?? '']);
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}
const userIdOf = async (email: string) => (await owner.query('select id from app.users where email = $1', [email])).rows[0].id as string;

// --- SCHEMA ---------------------------------------------------------------------------------------
test('SCHEMA-001 app role owns nothing and cannot bypass RLS', async () => {
  const role = (await owner.query(`select rolsuper, rolbypassrls from pg_roles where rolname = 'dropdesk_app'`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
  const owned = (await owner.query(`select count(*)::int as n from pg_tables where schemaname = 'app' and tableowner = 'dropdesk_app'`)).rows[0].n;
  assert.equal(owned, 0);
  const noRls = (await owner.query(`select relname from pg_class where relnamespace = 'app'::regnamespace and relname in ('tenants','memberships','audit_events','idempotency_keys') and not relrowsecurity`)).rows;
  assert.deepEqual(noRls, []);
});

// --- AUTH / TENANCY -------------------------------------------------------------------------------
test('AUTH-001 merchant B cannot reach merchant A through the API', async () => {
  const a = await newUser('ada'); const b = await newUser('bayo');
  const tenantA = await newTenant(a.cookie, 'ada-foods');
  await newTenant(b.cookie, 'bayo-wears');
  const sw = await call('POST', '/v1/session/tenant', { cookie: b.cookie, body: { tenant_id: tenantA } });
  assert.equal(sw.status, 404, 'switching into a foreign tenant must look like it does not exist');
  const unknown = await call('POST', '/v1/session/tenant', { cookie: b.cookie, body: { tenant_id: '11111111-1111-4111-8111-111111111111' } });
  assert.deepEqual([unknown.status, unknown.body.code], [404, sw.body.code], 'foreign and non-existent tenants are indistinguishable');
  const members = await call('GET', '/v1/members', { cookie: b.cookie });
  assert.ok(members.body.members.every((m: { email: string }) => m.email !== a.email));
});

test('AUTH-001b RLS isolates at the SQL layer even if app code forgets a WHERE clause', async () => {
  const a = await newUser('chi'); const b = await newUser('dayo');
  const tenantA = await newTenant(a.cookie, 'chi-kitchen');
  const tenantB = await newTenant(b.cookie, 'dayo-mart');
  const bId = await userIdOf(b.email);
  await asApp({ userId: bId, tenantId: tenantB }, async (c) => {
    assert.equal((await c.query('select * from app.memberships where tenant_id = $1', [tenantA])).rowCount, 0);
    assert.equal((await c.query('select * from app.audit_events where tenant_id = $1', [tenantA])).rowCount, 0);
    assert.equal((await c.query('select * from app.tenants where id = $1', [tenantA])).rowCount, 0);
  });
  // Forged context: B claims tenant A. Membership check inside the policy still denies.
  await asApp({ userId: bId, tenantId: tenantA }, async (c) => {
    assert.equal((await c.query('select * from app.memberships where tenant_id = $1', [tenantA])).rowCount, 0);
    assert.equal((await c.query('select * from app.audit_events')).rowCount, 0);
  });
});

test('AUTH-002 no context means no rows (fail closed)', async () => {
  await asApp({}, async (c) => {
    for (const t of ['tenants', 'memberships', 'audit_events', 'idempotency_keys']) {
      assert.equal((await c.query(`select * from app.${t}`)).rowCount, 0, t);
    }
  });
});

test('AUTH-003 cannot insert a membership into another tenant', async () => {
  const a = await newUser('emeka'); const b = await newUser('funmi');
  const tenantA = await newTenant(a.cookie, 'emeka-parts');
  const bId = await userIdOf(b.email);
  await assert.rejects(
    asApp({ userId: bId, tenantId: tenantA }, (c) => c.query(`insert into app.memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [tenantA, bId])),
    /row-level security/,
  );
});

test('AUTH-004 credentials are not selectable by the app role', async () => {
  await asApp({}, async (c) => {
    await assert.rejects(c.query('select password_hash from app.users'), /permission denied/);
  });
});

test('AUTH-005 unknown email and wrong password give the same answer', async () => {
  const u = await newUser('gbenga');
  const wrong = await call('POST', '/v1/auth/login', { body: { email: u.email, password: 'not-the-password' } });
  const unknown = await call('POST', '/v1/auth/login', { body: { email: 'nobody.here@example.ng', password: 'not-the-password' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.detail, unknown.body.detail);
});

test('THROTTLE-001 five failures lock the identifier for 15 minutes, even with the right password', async () => {
  const u = await newUser('halima');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/v1/auth/login', { body: { email: u.email, password: 'wrong-password-x' } })).status, 401);
  const locked = await call('POST', '/v1/auth/login', { body: { email: u.email, password: u.password } });
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('retry-after'), '900');
  assert.equal(locked.body.code, 'RATE_LIMITED');
});

// --- RBAC -----------------------------------------------------------------------------------------
test('RBAC-001 dispatcher can read the roster but not manage members or read audit', async () => {
  const o = await newUser('ifeoma'); const d = await newUser('jide');
  const t = await newTenant(o.cookie, 'ifeoma-bakes');
  assert.equal((await call('POST', '/v1/members', { cookie: o.cookie, idem: 'add-jide-0001', body: { email: d.email, role: 'dispatcher' } })).status, 201);
  assert.equal((await call('POST', '/v1/session/tenant', { cookie: d.cookie, body: { tenant_id: t } })).status, 200);
  assert.equal((await call('GET', '/v1/members', { cookie: d.cookie })).status, 200);
  const add = await call('POST', '/v1/members', { cookie: d.cookie, idem: 'dispatcher-tries', body: { email: o.email, role: 'owner' } });
  assert.deepEqual([add.status, add.body.code], [403, 'FORBIDDEN']);
  assert.equal((await call('GET', '/v1/audit-events', { cookie: d.cookie })).status, 403);
});

test('RBAC-002 revoking a member takes effect on their very next request', async () => {
  const o = await newUser('kemi'); const d = await newUser('lanre');
  const t = await newTenant(o.cookie, 'kemi-prints');
  await call('POST', '/v1/members', { cookie: o.cookie, idem: 'add-lanre-01', body: { email: d.email, role: 'dispatcher' } });
  await call('POST', '/v1/session/tenant', { cookie: d.cookie, body: { tenant_id: t } });
  assert.equal((await call('GET', '/v1/members', { cookie: d.cookie })).status, 200);
  assert.equal((await call('DELETE', `/v1/members/${await userIdOf(d.email)}`, { cookie: o.cookie })).status, 204);
  assert.equal((await call('GET', '/v1/members', { cookie: d.cookie })).status, 403);
});

test('RBAC-003 an owner cannot remove themselves', async () => {
  const o = await newUser('musa');
  await newTenant(o.cookie, 'musa-logistics');
  const r = await call('DELETE', `/v1/members/${await userIdOf(o.email)}`, { cookie: o.cookie });
  assert.equal(r.status, 422);
});

// --- IDEMPOTENCY ----------------------------------------------------------------------------------
test('IDEM-001 replaying a key returns the original response and creates one tenant', async () => {
  const u = await newUser('ngozi');
  const req = { cookie: u.cookie, idem: 'tenant-ngozi-001', body: { slug: 'ngozi-styles', name: 'Ngozi Styles' } };
  const first = await call('POST', '/v1/tenants', req);
  const again = await call('POST', '/v1/tenants', req);
  assert.equal(first.status, 201);
  assert.deepEqual(again.body, first.body);
  assert.equal(again.headers.get('idempotent-replayed'), 'true');
  assert.equal((await owner.query(`select count(*)::int as n from app.tenants where slug = 'ngozi-styles'`)).rows[0].n, 1);
});

test('IDEM-002 same key with a different body is rejected; missing key is rejected', async () => {
  const u = await newUser('obi');
  await call('POST', '/v1/tenants', { cookie: u.cookie, idem: 'tenant-obi-0001', body: { slug: 'obi-one', name: 'Obi One' } });
  const reuse = await call('POST', '/v1/tenants', { cookie: u.cookie, idem: 'tenant-obi-0001', body: { slug: 'obi-two', name: 'Obi Two' } });
  assert.deepEqual([reuse.status, reuse.body.code], [422, 'IDEMPOTENCY_KEY_REUSED']);
  const missing = await call('POST', '/v1/tenants', { cookie: u.cookie, body: { slug: 'obi-three', name: 'Obi Three' } });
  assert.deepEqual([missing.status, missing.body.code], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
});

test('IDEM-003 concurrent duplicates (flaky network double-tap) create exactly one tenant', async () => {
  const u = await newUser('pelumi');
  const req = { cookie: u.cookie, idem: 'tenant-pelumi-01', body: { slug: 'pelumi-hub', name: 'Pelumi Hub' } };
  const results = await Promise.all([call('POST', '/v1/tenants', req), call('POST', '/v1/tenants', req), call('POST', '/v1/tenants', req)]);
  assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.status)));
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  assert.equal((await owner.query(`select count(*)::int as n from app.tenants where slug = 'pelumi-hub'`)).rows[0].n, 1);
});

// --- SESSIONS & CSRF -------------------------------------------------------------------------------
test('SESSION-001 logout, expiry and tampering all end the session', async () => {
  const u = await newUser('queen');
  assert.equal((await call('GET', '/v1/me', { cookie: u.cookie })).status, 200);
  assert.equal((await call('GET', '/v1/me', { cookie: u.cookie + 'x' })).status, 401);
  assert.equal((await call('POST', '/v1/auth/logout', { cookie: u.cookie })).status, 204);
  assert.equal((await call('GET', '/v1/me', { cookie: u.cookie })).status, 401);
  const v = await newUser('rotimi');
  await owner.query(`update app.sessions set last_seen_at = now() - interval '31 minutes' where user_id = $1`, [await userIdOf(v.email)]);
  assert.equal((await call('GET', '/v1/me', { cookie: v.cookie })).status, 401, 'idle timeout');
});

test('SESSION-002 session cookie is HttpOnly + SameSite and the token is stored hashed', async () => {
  const email = `sade.${++n}@example.ng`;
  await call('POST', '/v1/auth/signup', { body: { email, display_name: 'Sade', password: 'a-strong-passphrase' } });
  const login = await call('POST', '/v1/auth/login', { body: { email, password: 'a-strong-passphrase' } });
  const setCookie = login.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const token = setCookie.split(';')[0]!.split('=')[1]!;
  const raw = await owner.query('select 1 from app.sessions where token_hash = $1', [Buffer.from(token)]);
  assert.equal(raw.rowCount, 0, 'raw token must not be stored');
});

test('CSRF-001 state-changing requests need our Origin', async () => {
  const u = await newUser('tobi');
  const none = await call('POST', '/v1/tenants', { cookie: u.cookie, idem: 'csrf-test-01', origin: null, body: { slug: 'tobi-x', name: 'Tobi X' } });
  const evil = await call('POST', '/v1/tenants', { cookie: u.cookie, idem: 'csrf-test-02', origin: 'https://evil.example', body: { slug: 'tobi-y', name: 'Tobi Y' } });
  assert.deepEqual([none.status, none.body.code], [403, 'CROSS_ORIGIN_REQUEST']);
  assert.equal(evil.status, 403);
});

test('PROBLEM-001 errors are problem+json with a request id', async () => {
  const r = await handle(new Request(`${ORIGIN}/v1/nope`));
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('content-type'), 'application/problem+json');
  const b = await r.json();
  assert.match(b.request_id, /^req_/);
  assert.equal(r.headers.get('x-request-id'), b.request_id);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

// --- AUDIT ----------------------------------------------------------------------------------------
test('AUDIT-001 concurrent appends stay gapless and the chain verifies', async () => {
  const o = await newUser('uche');
  const t = await newTenant(o.cookie, 'uche-farms');
  await Promise.all(Array.from({ length: 12 }, () => call('POST', '/v1/session/tenant', { cookie: o.cookie, body: { tenant_id: t } })));
  const seqs = (await owner.query('select seq from app.audit_events where chain_id = $1 order by seq', [t])).rows.map((r) => Number(r.seq));
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1));
  const v = await call('GET', '/v1/audit-events/verify', { cookie: o.cookie });
  assert.deepEqual(v.body, { ok: true, checked: seqs.length, brokenAtSeq: null, reason: null });
});

test('AUDIT-002 audit is append-only for the app and even for the owner', async () => {
  const o = await newUser('victor');
  const t = await newTenant(o.cookie, 'victor-tools');
  const vId = await userIdOf(o.email);
  await asApp({ userId: vId, tenantId: t }, async (c) => {
    await assert.rejects(c.query(`update app.audit_events set action = 'x.y'`), /permission denied/);
  });
  await assert.rejects(owner.query('delete from app.audit_events where chain_id = $1', [t]), /append-only/);
});

test('CUST-002 (audit) tampering is detected at the exact event', async () => {
  const o = await newUser('wale');
  const t = await newTenant(o.cookie, 'wale-electric');
  await call('POST', '/v1/session/tenant', { cookie: o.cookie, body: { tenant_id: t } });
  await call('POST', '/v1/session/tenant', { cookie: o.cookie, body: { tenant_id: t } });
  // An insider with owner credentials bypasses the trigger and edits event 2.
  await owner.query('alter table app.audit_events disable trigger audit_events_append_only');
  await owner.query(`update app.audit_events set payload = '{"edited":true}' where chain_id = $1 and seq = 2`, [t]);
  await owner.query('alter table app.audit_events enable trigger audit_events_append_only');
  const v = await call('GET', '/v1/audit-events/verify', { cookie: o.cookie });
  assert.deepEqual([v.body.ok, v.body.brokenAtSeq, v.body.reason], [false, 2, 'event_hash does not match contents']);
});
