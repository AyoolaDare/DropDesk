'use client';
import type { Problem } from '@dropdesk/contracts';

export type Result<T> = { ok: true; data: T } | { ok: false; problem: Problem | null; offline: boolean };

/** Browser → /v1. Adds an Idempotency-Key to every POST so a retried tap can't double-create. */
export async function send<T>(method: 'POST' | 'DELETE', path: string, body?: unknown, idemKey?: string): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...(method === 'POST' ? { 'idempotency-key': idemKey ?? crypto.randomUUID() } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return res.ok ? { ok: true, data: json as T } : { ok: false, problem: json as Problem, offline: false };
  } catch {
    return { ok: false, problem: null, offline: true };
  }
}

export function messageFor(r: Extract<Result<unknown>, { ok: false }>): string {
  if (r.offline) return "You're offline or the network dropped. Nothing was saved. Try again when you're back online.";
  return r.problem?.detail ?? r.problem?.title ?? 'Something went wrong.';
}

export function fieldErrors(r: Extract<Result<unknown>, { ok: false }>): Record<string, string> {
  return Object.fromEntries((r.problem?.errors ?? []).map((e) => [e.field, e.message]));
}
