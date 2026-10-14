'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { send, messageFor, fieldErrors } from '@/lib/client';
import { Alert } from '@/components/Alert';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? ''), password = String(f.get('password') ?? '');
    if (mode === 'signup') {
      const r = await send('POST', '/v1/auth/signup', { email, password, display_name: String(f.get('display_name') ?? '') });
      if (!r.ok) { setBusy(false); setError(messageFor(r)); setFields(fieldErrors(r)); return; }
    }
    const r = await send('POST', '/v1/auth/login', { email, password });
    if (!r.ok) { setBusy(false); setError(messageFor(r)); return; }
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[1100px] items-center gap-8 px-4 py-8 md:grid-cols-2 md:px-8">
      <section aria-hidden className="relative hidden overflow-hidden rounded-3xl bg-hero p-10 text-white md:block">
        <p className="text-sm font-light text-white/80">DropDesk for Nigerian businesses</p>
        <p className="mt-2 text-3xl font-semibold leading-tight tracking-tight">Every delivery, rider and handover in one workspace.</p>
        <ul className="mt-8 space-y-3 text-sm font-light text-white/90">
          <li>✓ Use your own riders and couriers</li>
          <li>✓ Postcode or landmark, both work</li>
          <li>✓ A record of every handover</li>
        </ul>
        <svg viewBox="0 0 200 90" className="mt-10 w-full" aria-hidden>
          <rect x="0" y="70" width="200" height="14" rx="7" fill="#002B23" opacity=".35" />
          <circle cx="62" cy="70" r="11" fill="#0B1F1A" /><circle cx="62" cy="70" r="4.5" fill="#E2E8F0" />
          <circle cx="118" cy="70" r="11" fill="#0B1F1A" /><circle cx="118" cy="70" r="4.5" fill="#E2E8F0" />
          <rect x="40" y="30" width="28" height="24" rx="4" fill="#FBBF24" />
          <path d="M54 64 Q60 50 80 50 L104 50 Q118 50 126 64 Z" fill="#F97316" />
          <path d="M84 50 L88 26 Q90 18 99 20 L105 23 L107 42 L100 50 Z" fill="#fff" />
          <circle cx="97" cy="14" r="9" fill="#0F172A" /><path d="M99 10h7a4 4 0 010 8h-5z" fill="#67E8F9" />
          <path d="M160 64s-14-13-14-24a14 14 0 0128 0c0 11-14 24-14 24z" fill="#FDBA74" /><circle cx="160" cy="40" r="5" fill="#fff" />
        </svg>
      </section>

      <section className="bento mx-auto w-full max-w-md">
        <div className="flex items-center gap-3">
          <span className="tile bg-tile-teal"><svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 7l8-4 8 4v10l-8 4-8-4z" /><path d="M4 7l8 4 8-4M12 11v10" /></svg></span>
          <span className="text-lg font-semibold tracking-tight">DropDesk</span>
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
        <p className="mt-1 text-sm font-light text-ink-muted">{mode === 'signin' ? 'Welcome back.' : 'You can add your business after signing up.'}</p>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {mode === 'signup' && (
            <div>
              <label htmlFor="f-name" className="block text-sm font-medium">Your name</label>
              <input id="f-name" name="display_name" autoComplete="name" required className="field mt-1.5" aria-invalid={!!fields.display_name} aria-describedby="f-name-err" />
              {fields.display_name && <span id="f-name-err" className="mt-1 block text-xs text-alert">{fields.display_name}</span>}
            </div>
          )}
          <div>
            <label htmlFor="f-email" className="block text-sm font-medium">Email</label>
            <input id="f-email" name="email" type="email" autoComplete="email" required className="field mt-1.5" aria-invalid={!!fields.email} aria-describedby="f-email-err" />
            {fields.email && <span id="f-email-err" className="mt-1 block text-xs text-alert">{fields.email}</span>}
          </div>
          <div>
            <label htmlFor="f-pw" className="block text-sm font-medium">Password</label>
            <input id="f-pw" name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={10} className="field mt-1.5" aria-invalid={!!fields.password} aria-describedby="pw-help" />
            <span id="pw-help" className={`mt-1 block text-xs ${fields.password ? 'text-alert' : 'font-light text-ink-muted'}`}>{fields.password ?? (mode === 'signup' ? 'At least 10 characters. A short phrase works well.' : '')}</span>
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="mt-4 text-center text-sm font-light text-ink-muted">
          {mode === 'signin' ? 'New to DropDesk?' : 'Already have an account?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setFields({}); }} className="min-h-[44px] font-medium text-anchor">
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <p className="mt-2 text-center text-xs font-light text-ink-muted">By continuing you agree to the Terms and Privacy Notice.</p>
      </section>
    </main>
  );
}
