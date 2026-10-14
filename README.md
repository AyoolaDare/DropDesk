# DropDesk

Delivery operations workspace for Nigerian SMEs (Core release scope only). TypeScript modular monolith: Next.js web/PWA, a framework-free API router, PostgreSQL with row-level security.

```
apps/api        API router, handlers, migrations, DB tests
apps/web        Next.js app (mounts the API at /v1)
packages/*      contracts (wire types), security (RBAC, hashing, problem+json)
design/         UI explorations (responsive v2, workspace v3)
docs/           ADRs, sprint records, runbooks
tests/e2e       browser smoke tests
```

## Run locally

```bash
npm ci
cp .env.example .env.local          # set real passwords
DATABASE_OWNER_URL=… npm run db:migrate
psql "$DATABASE_OWNER_URL" -c "alter role dropdesk_app login password '…'"
npm run dev                          # http://localhost:3000
```

## Checks (same as CI)

```bash
npm run typecheck && npm run test:unit
DATABASE_OWNER_URL=postgres://…/dropdesk_test npm run test:db   # drops and recreates schema `app` in that database
npm run build
```

Status: Sprint 1 (foundation). See [docs/sprints/S1-foundation.md](docs/sprints/S1-foundation.md).
