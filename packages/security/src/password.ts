import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// scrypt via node:crypto, so no native add-on is needed on the build image.
// N=2^15, r=8, p=1 ≈ 32 MiB per hash. Revisit with a load test before pilot (S8).
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Verified against when the account doesn't exist, so response time doesn't reveal whether an email is registered. */
export const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

/** Sprint 1 policy: 10+ characters, not entirely one character class. Breached-password screening is P1. */
export function passwordProblems(password: string): string[] {
  const out: string[] = [];
  if (password.length < 10) out.push('Use at least 10 characters.');
  if (password.length > 200) out.push('Use at most 200 characters.');
  if (/^(.)\1*$/.test(password)) out.push('Avoid repeating a single character.');
  return out;
}
