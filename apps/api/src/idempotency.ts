import { HttpProblem, sha256, canonicalJson } from '@dropdesk/security';
import type { Tx } from './db/pool';

export interface StoredResponse { status: number; body: unknown }

/**
 * Runs `op` at most once per (user, Idempotency-Key). The key row is inserted first in the same
 * transaction, so a concurrent duplicate blocks on the unique index until the first commits, then
 * replays the stored response. If `op` throws, the rollback removes the key and the client may retry.
 */
export async function idempotent(
  tx: Tx,
  args: { userId: string; tenantId: string | null; key: string | null; method: string; path: string; body: unknown },
  op: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  if (!args.key) throw new HttpProblem('IDEMPOTENCY_KEY_REQUIRED');
  if (args.key.length < 8 || args.key.length > 128) {
    throw new HttpProblem('VALIDATION_FAILED', { errors: [{ field: 'Idempotency-Key', message: 'Use 8–128 characters, e.g. a UUID.' }] });
  }
  const fingerprint = sha256(`${args.method} ${args.path} ${canonicalJson(args.body ?? null)}`);
  const inserted = await tx.query(
    `insert into app.idempotency_keys (user_id, idem_key, tenant_id, request_fingerprint) values ($1,$2,$3,$4)
     on conflict (user_id, idem_key) do nothing`,
    [args.userId, args.key, args.tenantId, fingerprint],
  );
  if (inserted.rowCount === 0) {
    const prior = (await tx.query<{ request_fingerprint: Buffer; response_status: number | null; response_body: unknown; expired: boolean }>(
      `select request_fingerprint, response_status, response_body, expires_at < now() as expired
         from app.idempotency_keys where user_id = $1 and idem_key = $2`, [args.userId, args.key])).rows[0]!;
    if (!prior.request_fingerprint.equals(fingerprint)) throw new HttpProblem('IDEMPOTENCY_KEY_REUSED');
    if (prior.response_status === null) throw new HttpProblem('IDEMPOTENCY_IN_PROGRESS');
    return { status: prior.response_status, body: prior.response_body, replayed: true };
  }
  const res = await op();
  await tx.query('update app.idempotency_keys set response_status = $3, response_body = $4 where user_id = $1 and idem_key = $2',
    [args.userId, args.key, res.status, JSON.stringify(res.body)]);
  return { ...res, replayed: false };
}
