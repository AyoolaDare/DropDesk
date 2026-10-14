-- DropDesk S1 foundation: identity, tenancy, roles, sessions, idempotency, audit base.
-- Runs as the schema owner. The application connects as dropdesk_app: NOT the owner, NOT superuser,
-- NO BYPASSRLS. Every tenant table has RLS forced; tenant context comes only from
-- set_config('app.tenant_id', …, true) inside a transaction, which the server derives from the session.

create extension if not exists citext;

do $$ begin
  if not exists (select from pg_roles where rolname = 'dropdesk_app') then
    create role dropdesk_app nologin nosuperuser nobypassrls;  -- LOGIN + password granted by infra from the secret store
  end if;
end $$;

create schema app;
revoke all on schema app from public;
grant usage on schema app to dropdesk_app;

-- Context accessors. Missing or empty setting → NULL → every tenant policy evaluates false (fail closed).
create function app.current_tenant() returns uuid language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;
create function app.current_user_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Identity ---------------------------------------------------------------------------------------
create table app.users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  display_name  text not null check (length(display_name) between 1 and 120),
  password_hash text not null,
  mfa_enrolled  boolean not null default false,
  disabled_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table app.platform_roles (
  user_id    uuid not null references app.users(id),
  role       text not null check (role in ('ops_reviewer', 'security_admin')),
  granted_by uuid references app.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Tenancy ----------------------------------------------------------------------------------------
create table app.tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name            text not null check (length(name) between 2 and 120),
  lifecycle_state text not null default 'active' check (lifecycle_state in ('onboarding', 'active', 'suspended', 'closed')),
  created_at      timestamptz not null default now()
);

create table app.memberships (
  tenant_id  uuid not null references app.tenants(id),
  user_id    uuid not null references app.users(id),
  role       text not null check (role in ('owner', 'dispatcher')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (tenant_id, user_id)
);
create index memberships_user_idx on app.memberships(user_id) where revoked_at is null;

-- Security-definer helpers: read memberships without recursing through RLS. search_path is pinned.
create function app.has_role(p_tenant uuid, p_user uuid, p_role text) returns boolean
  language sql stable security definer set search_path = app, pg_temp
  as $$ select exists (select 1 from app.memberships
                       where tenant_id = p_tenant and user_id = p_user and revoked_at is null
                         and (p_role is null or role = p_role)) $$;

-- The app role may only ask about the *current* user, so these can't be used as a membership oracle.
create function app.is_member_of(p_tenant uuid) returns boolean
  language sql stable security definer set search_path = app, pg_temp
  as $$ select app.has_role(p_tenant, app.current_user_id(), null) $$;
create function app.is_member() returns boolean
  language sql stable security definer set search_path = app, pg_temp
  as $$ select app.has_role(app.current_tenant(), app.current_user_id(), null) $$;
create function app.is_owner() returns boolean
  language sql stable security definer set search_path = app, pg_temp
  as $$ select app.has_role(app.current_tenant(), app.current_user_id(), 'owner') $$;
revoke execute on function app.has_role(uuid, uuid, text) from public;

-- Tenant + first owner are created atomically; the app role has no direct INSERT on tenants.
create function app.create_tenant(p_slug text, p_name text) returns uuid
  language plpgsql security definer set search_path = app, pg_temp as $$
declare v_id uuid; v_user uuid := app.current_user_id();
begin
  if v_user is null then raise exception 'no user context' using errcode = '42501'; end if;
  insert into app.tenants(slug, name) values (p_slug, p_name) returning id into v_id;
  insert into app.memberships(tenant_id, user_id, role) values (v_id, v_user, 'owner');
  return v_id;
end $$;

-- Credentials are only readable through this function, never by selecting the column.
create function app.auth_credentials(p_email citext) returns table (id uuid, password_hash text, disabled_at timestamptz)
  language sql stable security definer set search_path = app, pg_temp
  as $$ select id, password_hash, disabled_at from app.users where email = p_email $$;

-- Sessions & throttling --------------------------------------------------------------------------
create table app.sessions (
  id               uuid primary key default gen_random_uuid(),
  token_hash       bytea not null unique,           -- SHA-256 of the 32-byte cookie token; raw token never stored
  user_id          uuid not null references app.users(id),
  active_tenant_id uuid references app.tenants(id),
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz
);
create index sessions_user_idx on app.sessions(user_id) where revoked_at is null;

create table app.login_attempts (
  id              bigint generated always as identity primary key,
  identifier_hash bytea not null,
  ip_hash         bytea,
  succeeded       boolean not null,
  attempted_at    timestamptz not null default now()
);
create index login_attempts_lookup_idx on app.login_attempts(identifier_hash, attempted_at desc);

-- Idempotency (scoped to the authenticated user; tenant recorded for audit) ---------------------
create table app.idempotency_keys (
  user_id             uuid not null references app.users(id),
  idem_key            text not null check (length(idem_key) between 8 and 128),
  tenant_id           uuid references app.tenants(id),
  request_fingerprint bytea not null,
  response_status     integer,
  response_body       jsonb,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '24 hours',
  primary key (user_id, idem_key)
);

-- Audit base -------------------------------------------------------------------------------------
-- One hash chain per tenant (chain_id = tenant_id) plus one platform chain (all-zero uuid).
create table app.audit_events (
  id             bigint generated always as identity primary key,
  chain_id       uuid not null,
  tenant_id      uuid references app.tenants(id),
  seq            bigint not null check (seq > 0),
  actor_user_id  uuid references app.users(id),
  actor_role     text not null,
  action         text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type    text,
  target_id      text,
  request_id     text,
  payload        jsonb not null default '{}'::jsonb,
  recorded_at    timestamptz not null,
  schema_version smallint not null default 1,
  prev_hash      bytea not null check (length(prev_hash) = 32),
  event_hash     bytea not null check (length(event_hash) = 32),
  unique (chain_id, seq),
  check ((tenant_id is null and chain_id = '00000000-0000-0000-0000-000000000000') or chain_id = tenant_id)
);

create function app.forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger audit_events_append_only before update or delete on app.audit_events
  for each row execute function app.forbid_mutation();
create trigger audit_events_no_truncate before truncate on app.audit_events
  for each statement execute function app.forbid_mutation();

-- Chain head for an append. Takes a transaction-scoped advisory lock so appends to one chain serialise.
-- The app may only append to its current tenant's chain or the platform chain.
create function app.audit_head(p_chain uuid) returns table (seq bigint, event_hash bytea, now timestamptz)
  language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if p_chain <> '00000000-0000-0000-0000-000000000000' and p_chain is distinct from app.current_tenant() then
    raise exception 'audit chain not in context' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_chain::text, 0));
  return query
    select coalesce(max(a.seq), 0)::bigint,
           coalesce((select a2.event_hash from app.audit_events a2 where a2.chain_id = p_chain order by a2.seq desc limit 1),
                    '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea),
           clock_timestamp()
      from app.audit_events a where a.chain_id = p_chain;
end $$;

-- Signed checkpoints. Written by the worker identity (S4); listed here so the schema is complete.
create table app.audit_anchors (
  id            bigint generated always as identity primary key,
  chain_id      uuid not null,
  seq_from      bigint not null,
  seq_to        bigint not null check (seq_to >= seq_from),
  root_hash     bytea not null,
  signer_key_id text not null,
  signature     bytea not null,
  archive_ref   text not null,
  created_at    timestamptz not null default now()
);

-- Row-level security -----------------------------------------------------------------------------
-- RLS binds dropdesk_app because it never owns these tables (asserted in tests). FORCE is deliberately
-- not used: the security-definer helpers run as the owner and must see the rows they guard.
alter table app.tenants          enable row level security;
alter table app.memberships      enable row level security;
alter table app.idempotency_keys enable row level security;
alter table app.audit_events     enable row level security;

create policy tenants_member_read on app.tenants for select to dropdesk_app
  using (app.is_member_of(id));

-- Members of the current tenant see its roster; any user sees their own memberships (tenant switcher).
create policy memberships_read on app.memberships for select to dropdesk_app
  using ((tenant_id = app.current_tenant() and app.is_member()) or user_id = app.current_user_id());
create policy memberships_owner_insert on app.memberships for insert to dropdesk_app
  with check (tenant_id = app.current_tenant() and app.is_owner());
create policy memberships_owner_update on app.memberships for update to dropdesk_app
  using (tenant_id = app.current_tenant() and app.is_owner())
  with check (tenant_id = app.current_tenant() and app.is_owner());

create policy idempotency_own on app.idempotency_keys for all to dropdesk_app
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy audit_tenant_read on app.audit_events for select to dropdesk_app
  using (tenant_id = app.current_tenant() and app.is_member());
create policy audit_append on app.audit_events for insert to dropdesk_app
  with check (tenant_id = app.current_tenant() or (tenant_id is null and chain_id = '00000000-0000-0000-0000-000000000000'));

-- Grants: least privilege for the app role ------------------------------------------------------
grant select (id, email, display_name, mfa_enrolled, disabled_at, created_at) on app.users to dropdesk_app;
grant insert (email, display_name, password_hash) on app.users to dropdesk_app;
grant select on app.tenants to dropdesk_app;
grant select, insert, update (role, revoked_at) on app.memberships to dropdesk_app;
grant select, insert, update (active_tenant_id, last_seen_at, revoked_at) on app.sessions to dropdesk_app;
grant select, insert on app.login_attempts to dropdesk_app;
grant select, insert, update (response_status, response_body), delete on app.idempotency_keys to dropdesk_app;
grant select, insert on app.audit_events to dropdesk_app;
revoke execute on all functions in schema app from public;
grant execute on function app.current_tenant(), app.current_user_id(), app.is_member(), app.is_owner(), app.is_member_of(uuid),
  app.create_tenant(text, text), app.auth_credentials(citext), app.audit_head(uuid) to dropdesk_app;
