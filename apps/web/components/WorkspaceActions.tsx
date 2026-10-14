'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { send, messageFor, fieldErrors } from '@/lib/client';
import { Alert } from './Alert';

export function SignOut() {
  const router = useRouter();
  return <button type="button" className="btn-quiet" onClick={async () => { await send('POST', '/v1/auth/logout'); router.replace('/login'); }}>Sign out</button>;
}

export function TenantSwitcher({ active, options }: { active: string | null; options: { tenant_id: string; name: string; role: string }[] }) {
  const router = useRouter();
  if (options.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm"><span className="sr-only">Business</span>
      <select defaultValue={active ?? ''} className="h-11 rounded-xl bg-white px-3 text-sm ring-1 ring-black/10"
        onChange={async (e) => { await send('POST', '/v1/session/tenant', { tenant_id: e.target.value }); router.refresh(); }}>
        {!active && <option value="" disabled>Choose a business</option>}
        {options.map((o) => <option key={o.tenant_id} value={o.tenant_id}>{o.name} · {o.role}</option>)}
      </select>
    </label>
  );
}

/** One idempotency key per form instance: a double-tap or retry after a dropped response replays, never duplicates. */
function useFormKey() { const [k, setK] = useState(() => crypto.randomUUID()); return [k, () => setK(crypto.randomUUID())] as const; }

export function CreateTenantForm() {
  const router = useRouter();
  const [key, rotate] = useFormKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <form className="mt-5 space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null); setFields({});
      const f = new FormData(e.currentTarget);
      const r = await send<{ id: string }>('POST', '/v1/tenants', { name: f.get('name'), slug: f.get('slug') }, key);
      if (!r.ok) { setBusy(false); setError(messageFor(r)); setFields(fieldErrors(r)); return; }
      rotate();
      await send('POST', '/v1/session/tenant', { tenant_id: r.data.id });
      router.refresh();
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <label htmlFor="t-name" className="block text-sm font-medium">Business name</label>
        <input id="t-name" name="name" required className="field mt-1.5" placeholder="e.g. Bisi's Kitchen" aria-invalid={!!fields.name} aria-describedby="t-name-err" />
        {fields.name && <span id="t-name-err" className="mt-1 block text-xs text-alert">{fields.name}</span>}
      </div>
      <div>
        <label htmlFor="t-slug" className="block text-sm font-medium">Workspace address</label>
        <span className="mt-1.5 flex h-12 items-center overflow-hidden rounded-xl bg-white ring-1 ring-black/10 focus-within:ring-2 focus-within:ring-anchor">
          <span aria-hidden className="px-3 font-mono text-sm text-ink-muted">dropdesk.app/</span>
          <input id="t-slug" name="slug" required pattern="[a-z0-9-]{3,40}" className="h-full min-w-0 flex-1 pr-3 font-mono text-base outline-none" placeholder="bisis-kitchen" aria-invalid={!!fields.slug} aria-describedby="t-slug-help" />
        </span>
        <span id="t-slug-help" className={`mt-1 block text-xs ${fields.slug ? 'text-alert' : 'font-light text-ink-muted'}`}>{fields.slug ?? 'Lowercase letters, numbers and hyphens.'}</span>
      </div>
      <button disabled={busy} className="btn-primary w-full sm:w-auto">{busy ? 'Creating…' : 'Create business'}</button>
    </form>
  );
}

export function AddMemberForm() {
  const router = useRouter();
  const [key, rotate] = useFormKey();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  return (
    <form className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget; const f = new FormData(form);
      const r = await send('POST', '/v1/members', { email: f.get('email'), role: f.get('role') }, key);
      if (!r.ok) { setMsg({ tone: 'error', text: messageFor(r) }); return; }
      rotate(); form.reset(); setMsg({ tone: 'success', text: 'Member added.' }); router.refresh();
    }}>
      <label className="sr-only" htmlFor="m-email">Email</label>
      <input id="m-email" name="email" type="email" required placeholder="teammate@business.ng" className="field" />
      <label className="sr-only" htmlFor="m-role">Role</label>
      <select id="m-role" name="role" className="field"><option value="dispatcher">Dispatcher</option><option value="owner">Owner</option></select>
      <button className="btn-primary">Add</button>
      {msg && <div className="sm:col-span-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </form>
  );
}
