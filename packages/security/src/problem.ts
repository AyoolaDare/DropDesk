import { ErrorCode, PROBLEM_CONTENT_TYPE, type Problem } from '@dropdesk/contracts';

const TITLES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in required',
  FORBIDDEN: 'You do not have permission for this action',
  NOT_FOUND: 'Not found',
  VALIDATION_FAILED: 'Some fields are invalid',
  VERSION_CONFLICT: 'This record changed since you loaded it',
  ALREADY_EXISTS: 'That already exists',
  IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key header is required',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency-Key was already used with a different request',
  IDEMPOTENCY_IN_PROGRESS: 'A request with this Idempotency-Key is still being processed',
  RATE_LIMITED: 'Too many attempts',
  CROSS_ORIGIN_REQUEST: 'Request origin is not allowed',
  INTERNAL: 'Something went wrong on our side',
};

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422, VERSION_CONFLICT: 409,
  ALREADY_EXISTS: 409, IDEMPOTENCY_KEY_REQUIRED: 400, IDEMPOTENCY_KEY_REUSED: 422, IDEMPOTENCY_IN_PROGRESS: 409,
  RATE_LIMITED: 429, CROSS_ORIGIN_REQUEST: 403, INTERNAL: 500,
};

/** Thrown inside handlers; the router turns it into problem+json. */
export class HttpProblem extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly errors: Problem['errors'];
  readonly headers: Record<string, string>;
  constructor(code: ErrorCode, opts: { detail?: string; errors?: Problem['errors']; headers?: Record<string, string> } = {}) {
    super(TITLES[code]);
    this.code = code;
    this.status = STATUS[code];
    this.detail = opts.detail;
    this.errors = opts.errors;
    this.headers = opts.headers ?? {};
  }
}

export function problemResponse(p: HttpProblem, requestId: string): Response {
  const body: Problem = {
    type: `https://docs.dropdesk.app/problems/${p.code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[p.code],
    status: p.status,
    code: p.code,
    request_id: requestId,
    ...(p.detail ? { detail: p.detail } : {}),
    ...(p.errors ? { errors: p.errors } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: p.status,
    headers: { 'content-type': PROBLEM_CONTENT_TYPE, 'x-request-id': requestId, ...p.headers },
  });
}
