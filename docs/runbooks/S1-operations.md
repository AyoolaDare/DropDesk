# Runbook: S1 foundation operations

Owner: DevOps · Applies to: staging and production · Last reviewed: S1 close

## Identities and secrets

| Identity | Used by | Privileges | Where the secret lives |
|---|---|---|---|
| `dd_owner` (schema owner) | Migration job only | DDL on schema `app` | Secret store path `dropdesk/<env>/db-owner`; injected only into the release job |
| `dropdesk_app` | Web/API runtime | Grants in `0001_foundation.sql`; no BYPASSRLS, owns nothing | `dropdesk/<env>/db-app`; rotated every 90 days |

- The runtime container must not receive `DATABASE_OWNER_URL`. CI test SCHEMA-001 asserts the app role owns no tables and cannot bypass RLS.
- Create the app login once per environment (outside migrations so no password is committed):
  `ALTER ROLE dropdesk_app LOGIN PASSWORD :'from_secret_store';`
- Rotation: create the new password, update the secret, roll the web deployment, then confirm `pg_stat_activity` shows no sessions on the old credential.

## Release sequence

1. CI green on the commit (typecheck, unit, DB/tenancy tests, build, audit).
2. Take an on-demand snapshot (`pre-release-<sha>`).
3. Run `npm run db:migrate` with `DATABASE_OWNER_URL` (each file in its own transaction; a failure rolls back that file).
4. Deploy web. Health check: `GET /login` → 200 and `GET /v1/me` → 401 problem+json.
5. Watch the error rate and 5xx for 15 minutes. Roll back the deployment if 5xx > 1% (migrations are additive in S1; no down-migration needed).

## Backups (targets from Blueprint §12, unproven until the S8 restore drill)

- Provisional RPO 15 min: point-in-time recovery with WAL archiving on the managed Postgres; daily full snapshot kept 35 days.
- Provisional RTO 4 h: restore drill (RECOV-001) is scheduled for S8 and must be signed before pilot.
- `audit_events` is also checkpointed to the retention-locked archive once the S4 anchor worker ships. Until then the hash chain detects edits (CUST-002 test) but cannot prove what the original was.

## Fallbacks

| Symptom | First action |
|---|---|
| Spike in `auth.login.failed` on the platform chain | Check `login_attempts` by `ip_hash`; throttling is per identifier (5 per 15 min). Add an edge rate limit per IP if one source dominates. |
| `/v1/audit-events/verify` returns `ok:false` | Treat as a security incident. Freeze writes to that tenant if the cause is unknown, preserve the DB snapshot, and compare against the latest anchor. Never "repair" rows in place. |
| DB connections exhausted | Pool is 10 per instance with a 5 s statement timeout. Scale instances only after checking long-running queries. |
| Owner locked out (no other owner) | Support process (S5) with identity verification. Never edit memberships by hand without a recorded `security_admin` case. |

## Logging rules

Structured JSON per request: `request_id`, method, path, status, latency. Never log request bodies, cookies, tokens, passwords, OTPs or emails. Login failure audit events store a truncated identifier hash only.
