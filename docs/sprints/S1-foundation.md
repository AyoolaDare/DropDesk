# Sprint 1: Foundation (team record)

Baseline: *DropDesk Engineering Execution Blueprint v2.0* §13, S1 = "Auth, tenancy, roles, audit base; schema; pipeline; AD-01".
Code: `apps/api`, `apps/web`, `packages/*`, `.github/workflows/ci.yml` · Decision record: [`docs/adr/ADR-01-tenancy-identity-audit.md`](../adr/ADR-01-tenancy-identity-audit.md) · Runbook: [`docs/runbooks/S1-operations.md`](../runbooks/S1-operations.md)

---

## Phase 1: Alignment & specification

### [Business Analyst]
Source: Blueprint §2 (personas), §9 (API rules), §11 (threats), §12 (NFRs), plus v1.0 spec UI-01/UI-02.

**Functional rules (S1)**

| ID | Rule |
|---|---|
| BR-01 | A user is a global identity. Access to merchant data happens only through a **membership** (`owner` or `dispatcher`) in a tenant. |
| BR-02 | The acting tenant is taken from the server session. Request bodies never choose whose data is read. |
| BR-03 | Creating a tenant makes the creator its first owner, atomically. A tenant can't exist without an owner. |
| BR-04 | Only owners add or revoke members. Owners can't revoke themselves (prevents an ownerless tenant). |
| BR-05 | Revocation applies on the member's next request, not at session expiry. |
| BR-06 | Every security-relevant action writes an audit event that can't be edited or deleted through the product. |
| BR-07 | An identifier for which a tenant doesn't exist and one the caller can't access must be indistinguishable (403/404 policy, §9). |
| BR-08 | Creating writes (tenant, membership) must be safe to retry on a dropped mobile connection. |

**Edge cases handed to PM**

1. Double-tap "Create business" on a slow 3G link sends two POSTs → must produce one tenant (BR-08).
2. A dispatcher works in two businesses → needs a tenant switcher; their role differs per tenant.
3. A sacked dispatcher still has an open session on their phone → BR-05.
4. Credential stuffing against a known merchant email → throttling without revealing whether the email exists.
5. Attacker guesses another tenant's UUID and calls the switch endpoint → BR-07.
6. An insider with database owner access edits an audit row → must be *detectable*, even though S1 can't prevent it (anchors come in S4).
7. Sign-up with an email that already exists → reveals account existence (see PM decision D-3).

→ **Handing off to Product Manager.**

### [Product Manager / Product Owner]
*Integrating the BA's rules BR-01…08 and edge cases 1–7.*

| Story | Priority | Acceptance |
|---|---|---|
| US-1.1 As a merchant I can sign up and sign in with email + password | P0 | 10+ char password; generic failure message; 5 failures / 15 min → 429 with Retry-After |
| US-1.2 As a new owner I can create my business workspace | P0 | Slug rules; Idempotency-Key required; replay returns the same tenant |
| US-1.3 As an owner I can add/remove dispatchers by email | P0 | Owner-only; immediate revocation; can't remove self |
| US-1.4 As a member of several businesses I can switch business | P0 | Unknown and foreign tenant both 404 |
| US-1.5 As an owner I can see an audit trail and whether it is intact | P0 | Append-only; verify endpoint pinpoints a tampered event |
| US-1.6 As a platform operator I need CI to block cross-tenant regressions | P0 | AUTH-001 family runs on every PR against real Postgres |
| US-1.7 Password reset by email/SMS | P1 → **S2** | Blocked on messaging adapter (§10). Interim: support-assisted reset logged as `security_admin` case |
| US-1.8 Email verification at sign-up | P1 → S2 | Ships with the messaging adapter |
| US-1.9 MFA for privileged users (§11) | P0 for **platform roles** | S1 ships **no way to grant** `ops_reviewer`/`security_admin`, so the gate holds until MFA lands (S8 at latest) |

**Scope decisions**
- D-1: Orders, riders and the lifecycle state machine are **not** in S1 (S2/S3). Schema work is limited to identity, tenancy, sessions, idempotency and audit.
- D-2: Members must already have an account. Email invitations ship with rider invites in S3.
- D-3: Sign-up returns 409 for an existing email. This is an accepted enumeration risk until US-1.8. Throttling is already per identifier.

→ **Requesting Tech Lead feasibility review before Phase 2.**

### [Tech Lead / Engineering Manager]: critique loop
*Reviewing PM stories US-1.1…1.9.*

1. **Challenge: "RLS everywhere" vs. a privileged path.** Creating a tenant (US-1.2) needs an insert that no RLS policy allows yet, because the tenant doesn't exist. → Required: a single `SECURITY DEFINER` function that creates the tenant and owner together. No broad grants. **Accepted by Architect.**
2. **Challenge: idempotency semantics on concurrent duplicates** (edge case 1). A check-then-insert has a race. → The key row must be inserted inside the same transaction as the work, so the primary key serialises duplicates. **Accepted.**
3. **Challenge: audit ordering under concurrency.** `max(seq)+1` races. → Serialise per chain with a transaction-scoped advisory lock. QA to prove it with 12 parallel appends. **Accepted.**
4. **Challenge: "immutable" wording.** A hash chain only *detects* edits by someone with DB-owner access. → Stories say "can't be edited through the product; tampering is detected". Signed anchors are S4. **PM accepted the wording change.**
5. **Definition of Done (S1):** typecheck clean; unit + DB tests green in CI against Postgres 16; Next.js production build; no high/critical advisories in production dependencies; ADR-01 merged; runbook merged; E2E smoke at 360 px and 1440 px.

→ **Gate passed. Phase 2 may start.**

---

## Phase 2: Design & blueprinting

### [UI/UX Designer]
*Integrating PM stories US-1.1–1.5 and the v3 workspace system (`design/workspace`).*

- **Screens:** UI-01 Sign in / create account (single card, mode toggle) and UI-02-lite "Set up your business" plus the workspace shell (team panel, audit trail).
- **System:** light neutral backdrop with a faint teal mesh. Bento cards `rounded-2xl p-6 ring-1 ring-black/5`, hairline shadow only. Accent #006652, gradient used only on the hero band and icon tiles. Geist, `tracking-tight`, Light for helper text.
- **Glass** only on the sticky top bar.
- **Feedback:** every error is an icon + the word "Error:" + a sentence. Field errors sit under the field and are linked with `aria-describedby`. Nothing relies on colour alone.
- **Touch:** 44 px minimum targets; inputs at 16 px to stop Android zoom.
- **Slug field:** shows the `dropdesk.app/` prefix as a non-editable affix.
- **Laptop sign-in:** a gradient panel with a small 2D rider scene. Hidden on phones to keep the first paint light.

→ **Handing off to Front-End Developer** (components) and **Full-Stack Developer** (data the screens need: `GET /v1/me` returns memberships and the active tenant in one call).

### [Software Architect]
*Integrating Tech Lead challenges 1–4. Full rationale in ADR-01.*

**Tables (`apps/api/src/db/migrations/0001_foundation.sql`):** `users`, `platform_roles`, `tenants`, `memberships (PK tenant_id,user_id)`, `sessions (token_hash unique)`, `login_attempts`, `idempotency_keys (PK user_id,idem_key)`, `audit_events (unique chain_id,seq)`, `audit_anchors`.

**RLS model**
- Context: `app.current_tenant()` and `app.current_user_id()` read transaction-local settings. Empty → NULL → no rows (fail closed).
- `tenants`: visible if `is_member_of(id)`.
- `memberships`: read your own rows, or the roster of the current tenant if you're a member. Insert/update only if `is_owner()` in the current tenant.
- `audit_events`: read if the event is in the current tenant *and* you're a member. Insert only into the current tenant's chain or the platform chain.
- `idempotency_keys`: your own keys only.

**Privileged functions** (`SECURITY DEFINER`, `search_path` pinned): `create_tenant`, `auth_credentials`, `audit_head`, and `is_member` / `is_owner` / `is_member_of`.

**API (`apps/api/src/http/router.ts`)**

| Method | Path | Rule |
|---|---|---|
| POST | /v1/auth/signup | password policy; 409 duplicate (D-3) |
| POST | /v1/auth/login | throttle 5/15 min per identifier; dummy-hash timing equalisation |
| POST | /v1/auth/logout | revokes session |
| GET | /v1/me | user, memberships, active tenant |
| POST | /v1/session/tenant | 404 if not a member |
| POST | /v1/tenants | Idempotency-Key required |
| GET/POST | /v1/members | read: owner+dispatcher; write: owner, Idempotency-Key |
| DELETE | /v1/members/{userId} | owner; not self |
| GET | /v1/audit-events, /v1/audit-events/verify | owner |

Errors: RFC 9457 problem+json, stable `code`, `request_id`.

**Self-review (found before any code depended on it)**
- *Defect A:* `has_role(tenant, user)` was executable by the app role, which let it probe any user's membership in any tenant. **Fixed:** made private. The app only gets checks about the *current* user.
- *Defect B:* `FORCE ROW LEVEL SECURITY` also binds the table owner. The definer functions run as the owner and have no policy, so the audit head would read zero rows in production, where the owner isn't a superuser. **Fixed:** RLS without FORCE. The app role never owns tables, asserted by test SCHEMA-001.

→ **Handing off to Back-End, Full-Stack and Front-End Developers.**

---

## Phase 3: Implementation

### [Back-End Developer]
*Implementing the Architect's schema and the BA's BR-03…08.*

- `db/pool.ts`: `withTx(db, {userId, tenantId}, fn)` sets context with `set_config(…, true)`, so it can't leak across pooled connections.
- `audit.ts`:
  - **Hashing:** canonical JSON (keys sorted), `SHA-256(prev ‖ body)`.
  - **Timing:** `recorded_at` comes from the DB `clock_timestamp()`, never from the client.
  - **Verification:** `verifyRows()` works on exported rows, so auditors can check offline.
- `idempotency.ts`:
  - **Ordering:** inserts the key first, then does the work, then stores the response.
  - **Results:** a replay returns the stored response; a different body gives 422; in-flight gives 409.
  - **Failure:** a rolled-back failure frees the key.
- `@dropdesk/security`:
  - **Passwords:** scrypt N=2^15 via `node:crypto` (no native module), constant-time compare, and a dummy hash for unknown emails.
  - **Also:** the RBAC matrix and problem+json.
- **Login rework from my own review:** the failure path originally wrote its attempt inside a transaction that then rolled back, then wrote it again. Now each path writes exactly once.

→ **Handing off to Full-Stack Developer** for routing and the Next.js bridge.

### [Full-Stack Developer]
*Integrating Back-End services and the UI Designer's data needs.*

- **Router:** `createApi()` is framework-free, so it's directly testable without a server.
  - **Flow:** Request → CSRF Origin check → route → handler → problem+json.
  - **Headers:** `x-request-id` and `cache-control: no-store` on every response.
  - **Logging:** one structured log line per request with no bodies, cookies or emails.
- **Next.js bridge:** `apps/web/app/v1/[...path]/route.ts` mounts the same router. Server components call it in-process with the visitor's cookie (`lib/api.ts → serverGet`), so there's one auth path, not two.
- **Session:** the role is re-read from `memberships` on each request (BR-05).

→ **Handing off to Front-End Developer** with the contracts in `@dropdesk/contracts` (`MeResponse`, `AuditEventView`, `Problem`).

### [Front-End Developer]
*Implementing the UI Designer's spec against the Full-Stack contracts.*

- **`/login`:** sign-in and create-account modes. Server field errors map to fields; network loss shows "Nothing was saved…" and never a false success.
- **`/` (workspace):** server-rendered, with a glass top bar and tenant switcher (shown with 2+ memberships).
  - **No business yet:** a "Set up your business" form.
  - **Team panel:** members list, plus an add form for owners.
  - **Audit panel (owners):** last 8 events plus a "Chain verified · N events" or "Integrity check failed at event N" badge.
- **Idempotency in the client:** one key per form instance, rotated only after success, so a retry after a dropped response replays rather than duplicating.
- **Edge gate:** `middleware.ts` redirects to `/login` without a cookie. Real validation is server-side.
- **Security headers:** `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a Permissions-Policy blocking camera, mic and location until S4 asks for them.

→ **Handing off to QA.**

---

## Phase 4: Hardening & release gate

### [Quality Assurance Engineer]
*Integrating BA edge cases 1–7 and Blueprint §14.* Suite: `apps/api/test/foundation.test.ts`. It runs on real PostgreSQL 16 as the real `dropdesk_app` role.

| Test | Proves | Result |
|---|---|---|
| SCHEMA-001 | App role isn't superuser, has no BYPASSRLS, owns no tables; RLS enabled on tenant tables | ✅ |
| AUTH-001 | Merchant B can't switch into A; foreign and non-existent tenants return identical 404s | ✅ |
| AUTH-001b | Raw SQL as the app role with B's context sees 0 of A's rows; a forged context (B claims A) still sees 0 | ✅ |
| AUTH-002 | No context → 0 rows on every tenant table (fail closed) | ✅ |
| AUTH-003 | Inserting a membership into another tenant → RLS violation | ✅ |
| AUTH-004 | App role can't `select password_hash` | ✅ |
| AUTH-005 | Unknown email and wrong password return identical 401s | ✅ |
| THROTTLE-001 | 6th attempt after 5 failures → 429, `Retry-After: 900`, even with the right password | ✅ |
| RBAC-001 | Dispatcher: roster ✓, add member 403, audit 403 | ✅ |
| RBAC-002 | Revoked dispatcher is denied on their very next request | ✅ |
| RBAC-003 | Owner can't remove self | ✅ |
| IDEM-001 | Replay returns the same body plus `idempotent-replayed`; 1 tenant row | ✅ |
| IDEM-002 | Same key with a new body → 422; missing key → 400 | ✅ |
| IDEM-003 | 3 concurrent duplicates → 1 tenant, same id returned to all | ✅ |
| SESSION-001 | Logout, tampered cookie and 31-minute idle all → 401 | ✅ |
| SESSION-002 | HttpOnly + SameSite=Lax; raw token not stored | ✅ |
| CSRF-001 | Missing or foreign Origin on POST → 403 | ✅ |
| PROBLEM-001 | problem+json, `request_id` matches the header, `no-store` | ✅ |
| AUDIT-001 | 12 concurrent appends → gapless seq; chain verifies | ✅ |
| AUDIT-002 | App role UPDATE denied; owner DELETE blocked by trigger | ✅ |
| CUST-002 (audit) | Owner disables the trigger and edits event 2 → verify reports `brokenAtSeq: 2` | ✅ |

Unit tests (`packages/security`): 7/7 ✅ (canonical JSON, chain hash, scrypt, password policy, RBAC, problem+json).

**Mutation check: are the tests able to fail?** I deliberately broke the code, ran the suite, then restored it.

| Mutant | Tests that failed |
|---|---|
| Drop RLS on `memberships` | SCHEMA-001, AUTH-001b, AUTH-002, AUTH-003 |
| Remove the membership check from the audit read policy | AUTH-001b |
| Skip the idempotency fingerprint check | IDEM-002 |

**E2E** (`tests/e2e/smoke.mjs`, real browser against `next start`) at 360 px and 1440 px: redirect → validation message → sign-up → create business → add dispatcher → "Chain verified" → no horizontal scroll. ✅ both widths.
- *Defect found by E2E:* help text inside `<label>` polluted the field's accessible name ("Password At least 10 characters…"). **Fixed:** labels now carry only the name; help and errors are linked by `aria-describedby`.

**Open risks (not blocking S1):** sign-up enumeration (D-3); throttling is per identifier only, so an IP-level edge limit is needed before public launch; the red `aria-invalid` ring was not visually confirmed, but the text and icon error is.

→ **Handing off to DevOps.**

### [DevOps Engineer]
*Integrating QA's suite into the pipeline and the Architect's two-role model.*

- **CI** (`.github/workflows/ci.yml`): Postgres 16 service, then `npm ci`, typecheck, unit tests, DB/tenancy tests, Next.js build, and `npm audit --omit=dev --audit-level=high`. Least-privilege `permissions: contents: read`; concurrency cancels superseded runs.
- **Audit gate caught a real issue before merge:** Next.js 15.5.4 brought 1 critical and 2 high advisories.
  - **Upgrade:** Next.js to 15.5.27.
  - **Overrides:** npm `overrides` pin Next's bundled `postcss` → 8.5.30 and `sharp` → 0.35.5.
  - **Image optimisation disabled:** `next/image` optimisation is off in S1 (`images.unoptimized`).
  - **Result:** `found 0 vulnerabilities`, and the full suite re-ran green after a clean reinstall.
- **Secrets:**
  - **Two identities:** the owner URL is for the migration job only; the runtime gets the app-role URL.
  - **No committed passwords:** the app role's password is set outside migrations. `.env.example` documents both.
- **Runbook** (`docs/runbooks/S1-operations.md`): release sequence with a pre-release snapshot, credential rotation, backup targets (RPO 15 min / RTO 4 h, *provisional until the S8 restore drill*), audit-integrity incident response, and logging rules.

→ **Handing off to Project Manager for sign-off.**

### [Project Manager / Scrum Master]
*Checking against the Tech Lead's Definition of Done.*

| DoD item | Evidence | Status |
|---|---|---|
| Typecheck clean | `npm run typecheck` exit 0 | ✅ |
| Unit + DB tests green | 7/7 unit, 21/21 DB on Postgres 16 | ✅ |
| Production build | `next build` (Next 15.5.27) compiled and type-checked | ✅ |
| No high/critical prod advisories | `npm audit --omit=dev --audit-level=high` → 0 | ✅ |
| ADR-01 merged | `docs/adr/ADR-01-tenancy-identity-audit.md` | ✅ |
| Runbook merged | `docs/runbooks/S1-operations.md` | ✅ |
| E2E smoke 360 / 1440 | `tests/e2e/smoke.mjs` PASS ×2 | ✅ |
| CI runs on GitHub | Workflow committed; **first hosted run not yet observed** | ⏳ verify on first PR |

**Scope held:** orders, riders, lifecycle and NDAPS stayed out (D-1). No marketplace, insurance or guarantee language anywhere in the UI (Blueprint "READ THIS FIRST").

**Carried into S2:** US-1.7 password reset and US-1.8 email verification (both need the messaging adapter); OpenAPI generation from routes (§9); IP-level rate limit; benchmark of the RLS membership lookup before S6 reporting.
**Gated:** platform-role grants until MFA (US-1.9).

**Sign-off: S1 accepted, conditional on the first green hosted CI run.**
