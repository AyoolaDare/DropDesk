import { randomUUID } from 'node:crypto';
import { HttpProblem, problemResponse } from '@dropdesk/security';
import type { Db } from '../db/pool';
import * as h from './handlers';

type Handler = (ctx: h.Ctx) => Promise<Response>;
const ROUTES: [string, RegExp, Handler][] = [
  ['POST', /^\/v1\/auth\/signup$/, h.signup],
  ['POST', /^\/v1\/auth\/login$/, h.login],
  ['POST', /^\/v1\/auth\/logout$/, h.logout],
  ['GET', /^\/v1\/me$/, h.me],
  ['POST', /^\/v1\/session\/tenant$/, h.switchTenant],
  ['POST', /^\/v1\/tenants$/, h.createTenant],
  ['GET', /^\/v1\/members$/, h.listMembers],
  ['POST', /^\/v1\/members$/, h.addMember],
  ['DELETE', /^\/v1\/members\/(?<userId>[^/]+)$/, h.revokeMember],
  ['GET', /^\/v1\/audit-events$/, h.listAudit],
  ['GET', /^\/v1\/audit-events\/verify$/, h.verifyAudit],
];

export interface ApiOptions { db: Db; allowedOrigins: string[]; secureCookies: boolean; log?: (entry: Record<string, unknown>) => void }

/** Framework-free entry point: Request in, Response out. Next.js route handlers call this directly. */
export function createApi(opts: ApiOptions) {
  const log = opts.log ?? ((e) => console.log(JSON.stringify(e)));
  return async function handle(req: Request): Promise<Response> {
    const requestId = `req_${randomUUID()}`;
    const started = performance.now();
    const url = new URL(req.url);
    let res: Response;
    try {
      // CSRF: state-changing requests must come from our own origin (SameSite=Lax cookie is the second layer).
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('origin');
        if (!origin || !opts.allowedOrigins.includes(origin)) throw new HttpProblem('CROSS_ORIGIN_REQUEST');
      }
      const route = ROUTES.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) throw new HttpProblem('NOT_FOUND');
      const params = (url.pathname.match(route[1])?.groups ?? {}) as Record<string, string>;
      res = await route[2]({ db: opts.db, req, requestId, secureCookies: opts.secureCookies, params });
      res.headers.set('x-request-id', requestId);
    } catch (err) {
      if (err instanceof HttpProblem) res = problemResponse(err, requestId);
      else {
        log({ level: 'error', request_id: requestId, msg: (err as Error).message, stack: (err as Error).stack });
        res = problemResponse(new HttpProblem('INTERNAL'), requestId);
      }
    }
    res.headers.set('cache-control', 'no-store');
    // Never log bodies, cookies or emails; status + route + latency only.
    log({ level: 'info', request_id: requestId, method: req.method, path: url.pathname, status: res.status, ms: Math.round(performance.now() - started) });
    return res;
  };
}
