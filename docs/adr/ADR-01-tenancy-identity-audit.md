# ADR-01: Tenancy, identity and audit foundation

Status: Accepted (S1) · Deciders: Software Architect, Tech Lead, QA, DevOps · Blueprint refs: §2, §3, §8, §9, §11, §12

## Context
Every later module (orders, riders, custody) stores merchant data. A missed `WHERE tenant_id = …` in application code must not leak one merchant's data to another, and evidence must be tamper-evident.

## Decisions
1. **Shared database, shared schema, row-level isolation.** Every tenant table carries `tenant_id`. PostgreSQL RLS is the enforcement layer; application checks are the second layer. Chosen over schema-per-tenant (migration fan-out cost at SME scale) and database-per-tenant (cost).
2. **Context only from the server session.** `app.user_id` and `app.tenant_id` are set with `set_config(…, true)` (transaction-local) by `withTx`. Request bodies never carry the acting tenant. With no context set, policies return no rows.
3. **The app role never owns tables** and has no `BYPASSRLS`. Privileged operations (create tenant + first owner, read credentials, read the audit chain head) are narrow `SECURITY DEFINER` functions with a pinned `search_path`. `FORCE ROW LEVEL SECURITY` is deliberately not used, because those functions run as the owner.
4. **Membership checks only about the current user.** `has_role()` is private. The app may call `is_member()`, `is_owner()` and `is_member_of(id)`, which can't be used to probe other users.
5. **Sessions:** opaque 32-byte random token in an HttpOnly, SameSite=Lax cookie (Secure on https). Only its SHA-256 is stored. 12 h absolute and 30 min idle timeouts. The role is re-read on every request, so revocation is immediate.
6. **CSRF:** non-GET requests must carry an allowed `Origin`, with SameSite=Lax as the second layer.
7. **Idempotency:** `Idempotency-Key` is required on creating POSTs and scoped per user. The key row is inserted in the same transaction as the work, so concurrent duplicates serialise on the primary key and replay the stored response. A different body with the same key returns 422.
8. **Audit chain:** one hash chain per tenant plus a platform chain. `event_hash = SHA-256(prev_hash ‖ canonical_json(body))`, with keys sorted, so an exported chain can be verified offline. Appends serialise per chain using a transaction-scoped advisory lock. UPDATE, DELETE and TRUNCATE are blocked by triggers, including for the owner. A hash chain alone doesn't prove immutability (Blueprint §6): signed anchors to a retention-locked archive arrive with the S4 worker, and the `audit_anchors` table exists now.
9. **Errors** use RFC 9457 problem+json with a stable `code` and `request_id`. A foreign tenant id gives 404, the same as a non-existent one.

## Consequences
- Every new tenant table in later sprints must: add `tenant_id`, enable RLS with a policy that uses `app.current_tenant()` and `app.is_member()`, and add a negative cross-tenant test (CI gate).
- A long-running report needs care: RLS predicates add a membership lookup per row. `has_role` is a PK lookup, but benchmark before S6.
- Password hashing uses scrypt via `node:crypto` (no native build step). Revisit argon2id if the deploy image allows native modules.
