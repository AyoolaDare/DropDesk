import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { MeResponse, AuditEventView } from '@dropdesk/contracts';
import { serverGet } from '@/lib/api';
import { SignOut, TenantSwitcher, CreateTenantForm, AddMemberForm } from '@/components/WorkspaceActions';

export const dynamic = 'force-dynamic';

const lagos = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });

export default async function Workspace() {
  const cookie = (await cookies()).toString();
  const me = await serverGet<MeResponse>('/v1/me', cookie);
  if (me.status === 401) redirect('/login');
  const { user, active_tenant: t, memberships } = me.body;
  const isOwner = t?.role === 'owner';
  const [members, audit, verify] = t ? await Promise.all([
    serverGet<{ members: { user_id: string; display_name: string; email: string; role: string }[] }>('/v1/members', cookie),
    isOwner ? serverGet<{ events: AuditEventView[] }>('/v1/audit-events?limit=8', cookie) : null,
    isOwner ? serverGet<{ ok: boolean; checked: number; brokenAtSeq: number | null }>('/v1/audit-events/verify', cookie) : null,
  ]) : [null, null, null];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:px-8">
          <span className="tile h-8 w-8 rounded-lg bg-tile-teal"><svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M4 7l8-4 8 4v10l-8 4-8-4z" /><path d="M4 7l8 4 8-4M12 11v10" /></svg></span>
          <span className="font-semibold tracking-tight">DropDesk</span>
          <div className="ml-auto flex items-center gap-2">
            <TenantSwitcher active={t?.id ?? null} options={memberships} />
            <SignOut />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        <section className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white md:p-8">
          <p className="text-sm font-light text-white/80">{lagos.format(new Date())} WAT</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">Welcome, {user.display_name.split(' ')[0]}</h1>
          <p className="mt-2 text-sm font-light text-white/85">
            {t ? <>You're working in <strong className="font-semibold">{t.name}</strong> as <strong className="font-semibold">{t.role}</strong>.</> : 'Set up your business to start creating deliveries.'}
          </p>
        </section>

        {!t ? (
          <section className="bento max-w-xl" aria-labelledby="new-biz">
            <h2 id="new-biz" className="text-lg font-semibold tracking-tight">Set up your business</h2>
            <p className="mt-1 text-sm font-light text-ink-muted">You'll be the owner. You can invite dispatchers next.</p>
            <CreateTenantForm />
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className="bento lg:col-span-7" aria-labelledby="team">
              <h2 id="team" className="text-lg font-semibold tracking-tight">Team</h2>
              <p className="mt-1 text-sm font-light text-ink-muted">Owners manage people and billing. Dispatchers create and assign deliveries.</p>
              <ul className="mt-4 divide-y divide-black/5">
                {members?.body.members.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 py-3">
                    <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-tile-teal text-xs font-semibold text-white">{m.display_name.slice(0, 2).toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{m.display_name}</span><span className="block truncate text-xs font-light text-ink-muted">{m.email}</span></span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-ink-soft">{m.role}</span>
                  </li>
                ))}
              </ul>
              {isOwner && <AddMemberForm />}
            </section>

            {isOwner && (
              <section className="bento lg:col-span-5" aria-labelledby="audit">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="audit" className="text-lg font-semibold tracking-tight">Audit trail</h2>
                  {verify && (verify.body.ok
                    ? <span className="rounded-full bg-anchor-soft px-2.5 py-1 text-xs font-medium text-anchor-dark">✓ Chain verified · {verify.body.checked} events</span>
                    : <span role="alert" className="rounded-full bg-alert-soft px-2.5 py-1 text-xs font-medium text-alert ring-1 ring-alert-line">⚠ Integrity check failed at event {verify.body.brokenAtSeq}</span>)}
                </div>
                <p className="mt-1 text-sm font-light text-ink-muted">Append-only. Entries can't be edited or deleted.</p>
                <ol className="mt-4 space-y-3">
                  {audit?.body.events.map((e) => (
                    <li key={e.seq} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 text-sm">
                      <span className="font-mono text-xs text-ink-muted">#{e.seq}</span>
                      <span><span className="block font-medium">{e.action}</span><span className="block text-xs font-light text-ink-muted">{lagos.format(new Date(e.recorded_at))} · {e.actor_role} · <span className="font-mono">{e.event_hash.slice(0, 10)}…</span></span></span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </main>
    </>
  );
}
