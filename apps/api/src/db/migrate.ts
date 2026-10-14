import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending migrations in filename order, each in its own transaction, recorded in public.schema_migrations. */
export async function migrate(ownerUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{ name: string }>('select name from public.schema_migrations')).rows.map((r) => r.name));
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(dir, name), 'utf8'));
        await client.query('insert into public.schema_migrations(name) values ($1)', [name]);
        await client.query('commit');
        applied.push(name);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  migrate(url).then((a) => console.log(a.length ? `Applied: ${a.join(', ')}` : 'Up to date'));
}
