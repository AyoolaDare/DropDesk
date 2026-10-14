import { createHash } from 'node:crypto';

/**
 * Canonical JSON for hashing: object keys sorted by UTF-16 code unit order, no whitespace,
 * no undefined. Same input → same bytes on any machine, so an auditor can re-verify an exported
 * chain without the database (close to RFC 8785 for the value types we store).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite number in canonical JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported type in canonical JSON: ${typeof value}`);
}

export const GENESIS_HASH = Buffer.alloc(32);

/** event_hash = SHA-256(prev_hash ‖ UTF-8(canonical(body))) */
export function chainHash(prev: Buffer, body: unknown): Buffer {
  return createHash('sha256').update(prev).update(canonicalJson(body), 'utf8').digest();
}

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}
