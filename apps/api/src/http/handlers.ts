import { HttpProblem, can, Permission, hashPassword, verifyPassword, passwordProblems, DUMMY_HASH, sha256, type Permission as P } from '@dropdesk/security';
import { MembershipRole, type MeResponse, type AuditEventView } from '@dropdesk/contracts';
import { withTx, type Db } from '../db/pool';
import { appendAudit, verifyTenantChain } from '../audit';
import { idempotent } from '../idempotency';
import { authenticate, newSessionToken, sessionCookie, clearedSessionCookie, SESSION_TTL_SECONDS, type Principal } from './session';

export interface Ctx { db: Db; req: Request; requestId: string; secureCookies: boolean; params: Record<string, string> }

const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_FAILURES = 5;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function body<T extends Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new HttpProblem('VALIDATION_FAILED', { detail: 'Body too large.' });
  try {
    const v = JSON.parse(text || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpProblem('VALIDATION_FAILED', { detail: 'Body must be a JSON object.' });
  }
}

function str(v: unknown, field: string, errors: { field: string; message: string }[], opts: { min?: number; max?: number; pattern?: RegExp; message?: string } = {}): string {
  if (typeof v !== 'string') { errors.push({ field, message: 'Required.' }); return ''; }
  const t = v.trim();
  if ((opts.min && t.length < opts.min) || (opts.max && t.length > opts.max) || (opts.pattern && !opts.pattern.test(t))) {
    errors.push({ field, message: opts.message ?? 'Invalid value.' });
  }
  return t;
}

function fail(errors: { field: string; message: string }[]) {
  if (errors.length) throw new HttpProblem('VALIDATION_FAILED', { errors });
}

function require(p: Principal, permission: P): asserts p is Principal & { tenantId: string; role: MembershipRole } {
  if (!p.tenantId || !p.role) throw new HttpProblem('FORBIDDEN', { detail: 'Choose a business first.' });
  if (!can(p.role, permission)) throw new HttpProblem('FORBIDDEN');
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Auth ---------------------------------------------------------------------------------------

export async function signup({ db, req, requestId }: Ctx): Promise<Response> {
  const b = await body<{ email?: unknown; display_name?: unknown; password?: unknown }>(req);
  const errors: { field: string; message: string }[] = [];
  const email = str(b.email, 'email', errors, { max: 254, pattern: EMAIL, message: 'Enter a valid email address.' }).toLowerCase();
  const name = str(b.display_name, 'display_name', errors, { min: 1, max: 120 });
  const password = typeof b.password === 'string' ? b.password : '';
  for (const m of passwordProblems(password)) errors.push({ field: 'password', message: m });
  fail(errors);
  const hash = await hashPassword(password);
  try {
    const id = await withTx(db, {}, async (tx) => {
      const u = (await tx.query<{ id: string }>('insert into app.users (email, display_name, password_hash) values ($1,$2,$3) returning id', [email, name, hash])).rows[0]!;
      await appendAudit(tx, { tenantId: null, actorUserId: u.id, actorRole: 'user', action: 'user.registered', targetType: 'user', targetId: u.id, requestId });
      return u.id;
    });
    return json(201, { id });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpProblem('ALREADY_EXISTS', { detail: 'Try signing in instead.' });
    throw e;
  }
}

export async function login({ db, req, requestId, secureCookies }: Ctx): Promise<Response> {
  const b = await body<{ email?: unknown; password?: unknown }>(req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const idHash = sha256(`login:${email}`);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const failures = Number((await db.query<{ n: string }>(
    `select count(*) as n from app.login_attempts where identifier_hash = $1 and not succeeded and attempted_at > now() - make_interval(mins => $2)`,
    [idHash, LOGIN_WINDOW_MIN])).rows[0]!.n);
  if (failures >= LOGIN_MAX_FAILURES) {
    throw new HttpProblem('RATE_LIMITED', { detail: `Too many failed attempts. Try again in ${LOGIN_WINDOW_MIN} minutes or reset your password.`, headers: { 'retry-after': String(LOGIN_WINDOW_MIN * 60) } });
  }

  const cred = (await db.query<{ id: string; password_hash: string; disabled_at: Date | null }>('select * from app.auth_credentials($1)', [email])).rows[0];
  const ok = await verifyPassword(password, cred?.password_hash ?? DUMMY_HASH);   // same work whether or not the account exists
  const succeeded = ok && !!cred && !cred.disabled_at;

  if (!succeeded) {
    await withTx(db, {}, async (tx) => {
      await tx.query('insert into app.login_attempts (identifier_hash, ip_hash, succeeded) values ($1,$2,false)', [idHash, ip ? sha256(ip) : null]);
      await appendAudit(tx, { tenantId: null, actorUserId: null, actorRole: 'anonymous', action: 'auth.login.failed', requestId, payload: { identifier: idHash.toString('hex').slice(0, 16) } });
    });
    throw new HttpProblem('UNAUTHENTICATED', { detail: 'Email or password is incorrect.' });
  }
  const userId = cred!.id;
  const { token, hash } = newSessionToken();
  await withTx(db, { userId }, async (tx) => {
    await tx.query('insert into app.login_attempts (identifier_hash, ip_hash, succeeded) values ($1,$2,true)', [idHash, ip ? sha256(ip) : null]);
    await appendAudit(tx, { tenantId: null, actorUserId: userId, actorRole: 'user', action: 'auth.login.succeeded', requestId });
    // Default the active tenant when the user belongs to exactly one.
    const mine = (await tx.query<{ tenant_id: string }>('select tenant_id from app.memberships where user_id = $1 and revoked_at is null', [userId])).rows;
    await tx.query(`insert into app.sessions (token_hash, user_id, active_tenant_id, expires_at) values ($1,$2,$3, now() + make_interval(secs => $4))`,
      [hash, userId, mine.length === 1 ? mine[0]!.tenant_id : null, SESSION_TTL_SECONDS]);
  });
  return json(200, { ok: true }, { 'set-cookie': sessionCookie(token, secureCookies) });
}

export async function logout({ db, req, secureCookies }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  await db.query('update app.sessions set revoked_at = now() where id = $1', [p.sessionId]);
  return new Response(null, { status: 204, headers: { 'set-cookie': clearedSessionCookie(secureCookies) } });
}

export async function me({ db, req }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  const out = await withTx(db, { userId: p.userId, tenantId: p.tenantId }, async (tx): Promise<MeResponse> => {
    const user = (await tx.query('select id, email, display_name from app.users where id = $1', [p.userId])).rows[0];
    const memberships = (await tx.query(
      `select m.tenant_id, t.slug, t.name, m.role from app.memberships m join app.tenants t on t.id = m.tenant_id
        where m.user_id = $1 and m.revoked_at is null order by t.name`, [p.userId])).rows;
    const active = memberships.find((m) => m.tenant_id === p.tenantId);
    return { user, memberships, active_tenant: active ? { id: active.tenant_id, slug: active.slug, name: active.name, role: active.role } : null };
  });
  return json(200, out);
}

export async function switchTenant({ db, req, requestId }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  const b = await body<{ tenant_id?: unknown }>(req);
  const tenantId = typeof b.tenant_id === 'string' && UUID.test(b.tenant_id) ? b.tenant_id : null;
  // Unknown and not-a-member look identical, so tenant ids can't be probed.
  if (!tenantId) throw new HttpProblem('NOT_FOUND');
  await withTx(db, { userId: p.userId, tenantId }, async (tx) => {
    const ok = (await tx.query<{ ok: boolean }>('select app.is_member() as ok')).rows[0]!.ok;
    if (!ok) throw new HttpProblem('NOT_FOUND');
    await tx.query('update app.sessions set active_tenant_id = $1 where id = $2', [tenantId, p.sessionId]);
    await appendAudit(tx, { tenantId, actorUserId: p.userId, actorRole: 'member', action: 'session.tenant_switched', requestId });
  });
  return json(200, { tenant_id: tenantId });
}

// --- Tenancy ------------------------------------------------------------------------------------

export async function createTenant({ db, req, requestId }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  const b = await body<{ slug?: unknown; name?: unknown }>(req);
  const errors: { field: string; message: string }[] = [];
  const slug = str(b.slug, 'slug', errors, { pattern: SLUG, message: '3–40 lowercase letters, numbers or hyphens.' });
  const name = str(b.name, 'name', errors, { min: 2, max: 120, message: '2–120 characters.' });
  fail(errors);
  const res = await withTx(db, { userId: p.userId }, (tx) =>
    idempotent(tx, { userId: p.userId, tenantId: null, key: req.headers.get('idempotency-key'), method: 'POST', path: '/v1/tenants', body: { slug, name } }, async () => {
      await tx.query('savepoint create_tenant');
      try {
        const id = (await tx.query<{ id: string }>('select app.create_tenant($1, $2) as id', [slug, name])).rows[0]!.id;
        await tx.query(`select set_config('app.tenant_id', $1, true)`, [id]);
        await appendAudit(tx, { tenantId: id, actorUserId: p.userId, actorRole: 'owner', action: 'tenant.created', targetType: 'tenant', targetId: id, requestId, payload: { slug } });
        return { status: 201, body: { id, slug, name } };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new HttpProblem('ALREADY_EXISTS', { errors: [{ field: 'slug', message: 'That address is taken.' }] });
        throw e;
      }
    }));
  return json(res.status, res.body, res.replayed ? { 'idempotent-replayed': 'true' } : {});
}

export async function listMembers({ db, req }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  require(p, Permission.MembersRead);
  const rows = await withTx(db, { userId: p.userId, tenantId: p.tenantId }, async (tx) =>
    (await tx.query(`select m.user_id, u.display_name, u.email, m.role, m.created_at from app.memberships m join app.users u on u.id = m.user_id
                      where m.tenant_id = $1 and m.revoked_at is null order by m.created_at`, [p.tenantId])).rows);
  return json(200, { members: rows });
}

export async function addMember({ db, req, requestId }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  require(p, Permission.MembersManage);
  const b = await body<{ email?: unknown; role?: unknown }>(req);
  const errors: { field: string; message: string }[] = [];
  const email = str(b.email, 'email', errors, { pattern: EMAIL, message: 'Enter a valid email address.' }).toLowerCase();
  const role = (MembershipRole as readonly string[]).includes(b.role as string) ? (b.role as MembershipRole) : null;
  if (!role) errors.push({ field: 'role', message: `One of: ${MembershipRole.join(', ')}.` });
  fail(errors);
  const res = await withTx(db, { userId: p.userId, tenantId: p.tenantId }, (tx) =>
    idempotent(tx, { userId: p.userId, tenantId: p.tenantId, key: req.headers.get('idempotency-key'), method: 'POST', path: '/v1/members', body: { email, role } }, async () => {
      const user = (await tx.query<{ id: string }>('select id from app.users where email = $1', [email])).rows[0];
      // S1: members must already have an account. Email invitations ship with S3 (rider/staff invites).
      if (!user) throw new HttpProblem('NOT_FOUND', { detail: 'No DropDesk account uses that email yet. Ask them to sign up first.' });
      const r = await tx.query(
        `insert into app.memberships (tenant_id, user_id, role) values ($1,$2,$3)
         on conflict (tenant_id, user_id) do update set role = excluded.role, revoked_at = null
         where app.memberships.revoked_at is not null returning user_id`, [p.tenantId, user.id, role]);
      if (r.rowCount === 0) throw new HttpProblem('ALREADY_EXISTS', { detail: 'That person is already a member.' });
      await appendAudit(tx, { tenantId: p.tenantId, actorUserId: p.userId, actorRole: p.role, action: 'membership.created', targetType: 'user', targetId: user.id, requestId, payload: { role } });
      return { status: 201, body: { user_id: user.id, role } };
    }));
  return json(res.status, res.body, res.replayed ? { 'idempotent-replayed': 'true' } : {});
}

export async function revokeMember({ db, req, requestId, params }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  require(p, Permission.MembersManage);
  const userId = params.userId ?? '';
  if (!UUID.test(userId)) throw new HttpProblem('NOT_FOUND');
  if (userId === p.userId) throw new HttpProblem('VALIDATION_FAILED', { detail: 'Owners cannot remove themselves. Transfer ownership first.' });
  await withTx(db, { userId: p.userId, tenantId: p.tenantId }, async (tx) => {
    const r = await tx.query('update app.memberships set revoked_at = now() where tenant_id = $1 and user_id = $2 and revoked_at is null', [p.tenantId, userId]);
    if (r.rowCount === 0) throw new HttpProblem('NOT_FOUND');
    await appendAudit(tx, { tenantId: p.tenantId, actorUserId: p.userId, actorRole: p.role, action: 'membership.revoked', targetType: 'user', targetId: userId, requestId });
  });
  return new Response(null, { status: 204 });
}

// --- Audit --------------------------------------------------------------------------------------

export async function listAudit({ db, req }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  require(p, Permission.AuditRead);
  const url = new URL(req.url);
  const before = Number(url.searchParams.get('before_seq') ?? '0');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1), 200);
  const rows = await withTx(db, { userId: p.userId, tenantId: p.tenantId }, async (tx) =>
    (await tx.query(`select seq, action, actor_user_id, actor_role, target_type, target_id, recorded_at, encode(event_hash, 'hex') as event_hash
                       from app.audit_events where tenant_id = $1 and ($2 = 0 or seq < $2) order by seq desc limit $3`, [p.tenantId, before, limit])).rows);
  const events: AuditEventView[] = rows.map((r) => ({ ...r, seq: Number(r.seq), recorded_at: new Date(r.recorded_at).toISOString() }));
  return json(200, { events, next_before_seq: events.length === limit ? events.at(-1)!.seq : null });
}

export async function verifyAudit({ db, req }: Ctx): Promise<Response> {
  const p = await authenticate(db, req);
  require(p, Permission.AuditRead);
  const result = await withTx(db, { userId: p.userId, tenantId: p.tenantId }, (tx) => verifyTenantChain(tx, p.tenantId));
  return json(200, result);
}
