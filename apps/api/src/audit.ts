import { chainHash, GENESIS_HASH } from '@dropdesk/security';
import type { Tx } from './db/pool';

export const PLATFORM_CHAIN = '00000000-0000-0000-0000-000000000000';

export interface AuditInput {
  tenantId: string | null;          // null → platform chain (e.g. sign-in events)
  actorUserId: string | null;
  actorRole: string;
  action: string;                   // dotted, e.g. 'membership.created'
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown>;
}

/** The exact object that is hashed. Changing its shape requires a schema_version bump. */
function hashedBody(e: { chainId: string; seq: number; tenantId: string | null; actorUserId: string | null; actorRole: string; action: string; targetType: string | null; targetId: string | null; requestId: string | null; payload: Record<string, unknown>; recordedAt: string }) {
  return {
    v: 1, chain_id: e.chainId, seq: e.seq, tenant_id: e.tenantId, actor_user_id: e.actorUserId, actor_role: e.actorRole,
    action: e.action, target_type: e.targetType, target_id: e.targetId, request_id: e.requestId, payload: e.payload, recorded_at: e.recordedAt,
  };
}

/** Appends to the tenant (or platform) chain inside the caller's transaction. */
export async function appendAudit(tx: Tx, input: AuditInput): Promise<{ seq: number; hash: string }> {
  const chainId = input.tenantId ?? PLATFORM_CHAIN;
  const head = (await tx.query<{ seq: string; event_hash: Buffer; now: Date }>('select * from app.audit_head($1)', [chainId])).rows[0]!;
  const seq = Number(head.seq) + 1;
  const prev = head.seq === '0' ? GENESIS_HASH : head.event_hash;
  const recordedAt = head.now.toISOString();
  const e = {
    chainId, seq, tenantId: input.tenantId, actorUserId: input.actorUserId, actorRole: input.actorRole, action: input.action,
    targetType: input.targetType ?? null, targetId: input.targetId ?? null, requestId: input.requestId ?? null,
    payload: input.payload ?? {}, recordedAt,
  };
  const hash = chainHash(prev, hashedBody(e));
  await tx.query(
    `insert into app.audit_events (chain_id, tenant_id, seq, actor_user_id, actor_role, action, target_type, target_id, request_id, payload, recorded_at, prev_hash, event_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [chainId, e.tenantId, seq, e.actorUserId, e.actorRole, e.action, e.targetType, e.targetId, e.requestId, e.payload, recordedAt, prev, hash],
  );
  return { seq, hash: hash.toString('hex') };
}

export interface ChainVerification { ok: boolean; checked: number; brokenAtSeq: number | null; reason: string | null }

/** Recomputes every hash in a chain. Also used offline against an exported chain. */
export function verifyRows(rows: { chain_id: string; seq: string | number; tenant_id: string | null; actor_user_id: string | null; actor_role: string; action: string; target_type: string | null; target_id: string | null; request_id: string | null; payload: Record<string, unknown>; recorded_at: Date | string; prev_hash: Buffer; event_hash: Buffer }[]): ChainVerification {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const r of rows) {
    const seq = Number(r.seq);
    if (seq !== expectedSeq) return { ok: false, checked: expectedSeq - 1, brokenAtSeq: seq, reason: `gap: expected seq ${expectedSeq}` };
    if (!r.prev_hash.equals(prev)) return { ok: false, checked: seq - 1, brokenAtSeq: seq, reason: 'prev_hash does not match previous event' };
    const recordedAt = r.recorded_at instanceof Date ? r.recorded_at.toISOString() : new Date(r.recorded_at).toISOString();
    const h = chainHash(prev, hashedBody({
      chainId: r.chain_id, seq, tenantId: r.tenant_id, actorUserId: r.actor_user_id, actorRole: r.actor_role, action: r.action,
      targetType: r.target_type, targetId: r.target_id, requestId: r.request_id, payload: r.payload, recordedAt,
    }));
    if (!h.equals(r.event_hash)) return { ok: false, checked: seq - 1, brokenAtSeq: seq, reason: 'event_hash does not match contents' };
    prev = r.event_hash;
    expectedSeq++;
  }
  return { ok: true, checked: rows.length, brokenAtSeq: null, reason: null };
}

export async function verifyTenantChain(tx: Tx, tenantId: string): Promise<ChainVerification> {
  const rows = (await tx.query('select * from app.audit_events where chain_id = $1 order by seq', [tenantId])).rows;
  return verifyRows(rows);
}
