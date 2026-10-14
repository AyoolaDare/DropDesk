import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 5_000 });
}

/**
 * Context a transaction runs under. user_id and tenant_id come from the server-side session and
 * nothing else; request bodies never set them.
 */
export interface DbContext {
  userId?: string | null;
  tenantId?: string | null;
}

/** Runs `fn` in one transaction with RLS context set transaction-locally (is_local = true). */
export async function withTx<T>(db: Db, ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('begin');
    await tx.query(`select set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`, [ctx.userId ?? '', ctx.tenantId ?? '']);
    const out = await fn(tx);
    await tx.query('commit');
    return out;
  } catch (err) {
    await tx.query('rollback').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}
