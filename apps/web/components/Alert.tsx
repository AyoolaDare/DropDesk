export function Alert({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const err = tone === 'error';
  return (
    <p role={err ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl p-3 text-sm leading-relaxed ring-1 ${err ? 'bg-alert-soft text-alert ring-alert-line' : 'bg-anchor-soft text-anchor-dark ring-anchor-line'}`}>
      <svg aria-hidden className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {err ? <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></> : <path d="M5 12.5l4.5 4.5L19 7.5" />}
      </svg>
      <span><strong className="font-semibold">{err ? 'Error: ' : 'Done: '}</strong>{children}</span>
    </p>
  );
}
