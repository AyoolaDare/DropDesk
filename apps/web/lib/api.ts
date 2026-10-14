import 'server-only';
import { createApi, createPool } from '@dropdesk/api';

// One pool + handler per server process. DATABASE_URL must use the dropdesk_app role (never the owner).
const g = globalThis as unknown as { __ddApi?: (req: Request) => Promise<Response> };

export function api(): (req: Request) => Promise<Response> {
  if (!g.__ddApi) {
    const url = process.env.DATABASE_URL;
    const origin = process.env.APP_ORIGIN;
    if (!url || !origin) throw new Error('DATABASE_URL and APP_ORIGIN must be set');
    g.__ddApi = createApi({ db: createPool(url), allowedOrigins: origin.split(','), secureCookies: origin.startsWith('https://') });
  }
  return g.__ddApi;
}

/** Server-component helper: calls the API in-process with the visitor's cookie. */
export async function serverGet<T>(path: string, cookie: string): Promise<{ status: number; body: T }> {
  const res = await api()(new Request(`${process.env.APP_ORIGIN!.split(',')[0]}${path}`, { headers: { cookie } }));
  return { status: res.status, body: (await res.json()) as T };
}
