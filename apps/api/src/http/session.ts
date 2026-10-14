import { randomBytes } from 'node:crypto';
import { HttpProblem, sha256 } from '@dropdesk/security';
import type { MembershipRole } from '@dropdesk/contracts';
import { withTx, type Db } from '../db/pool';

export const SESSION_COOKIE = 'dd_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;   // absolute lifetime
export const SESSION_IDLE_SECONDS = 30 * 60;       // idle timeout

export interface Principal {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  role: MembershipRole | null;   // role in the active tenant, re-read on every request
}

export function newSessionToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}
export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/**
 * Resolves the session cookie to a principal. Tenant role is re-checked against memberships on
 * every request, so revoking a membership takes effect immediately, not when the session expires.
 */
export async function authenticate(db: Db, req: Request): Promise<Principal> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) throw new HttpProblem('UNAUTHENTICATED');
  const s = (await db.query<{ id: string; user_id: string; active_tenant_id: string | null }>(
    `update app.sessions set last_seen_at = now()
      where token_hash = $1 and revoked_at is null and expires_at > now()
        and last_seen_at > now() - make_interval(secs => $2)
     returning id, user_id, active_tenant_id`, [sha256(token), SESSION_IDLE_SECONDS])).rows[0];
  if (!s) throw new HttpProblem('UNAUTHENTICATED');
  let role: MembershipRole | null = null;
  if (s.active_tenant_id) {
    role = await withTx(db, { userId: s.user_id }, async (tx) =>
      (await tx.query<{ role: MembershipRole }>('select role from app.memberships where tenant_id = $1 and user_id = $2 and revoked_at is null',
        [s.active_tenant_id, s.user_id])).rows[0]?.role ?? null);
  }
  return { sessionId: s.id, userId: s.user_id, tenantId: role ? s.active_tenant_id : null, role };
}
