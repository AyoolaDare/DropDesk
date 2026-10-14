// Wire contracts shared by api and web. Errors follow RFC 9457 (application/problem+json).

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Stable machine codes. Clients branch on `code`, never on `title`. */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  ValidationFailed: 'VALIDATION_FAILED',
  VersionConflict: 'VERSION_CONFLICT',
  AlreadyExists: 'ALREADY_EXISTS',
  IdempotencyKeyRequired: 'IDEMPOTENCY_KEY_REQUIRED',
  IdempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
  IdempotencyInProgress: 'IDEMPOTENCY_IN_PROGRESS',
  RateLimited: 'RATE_LIMITED',
  CrossOrigin: 'CROSS_ORIGIN_REQUEST',
  Internal: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  request_id: string;
  detail?: string;
  errors?: { field: string; message: string }[];
}

export const MembershipRole = ['owner', 'dispatcher'] as const;
export type MembershipRole = (typeof MembershipRole)[number];

export interface MeResponse {
  user: { id: string; email: string; display_name: string };
  active_tenant: { id: string; slug: string; name: string; role: MembershipRole } | null;
  memberships: { tenant_id: string; slug: string; name: string; role: MembershipRole }[];
}

export interface AuditEventView {
  seq: number;
  action: string;
  actor_user_id: string | null;
  actor_role: string;
  target_type: string | null;
  target_id: string | null;
  recorded_at: string;
  event_hash: string;
}
