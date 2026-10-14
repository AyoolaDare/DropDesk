import type { MembershipRole } from '@dropdesk/contracts';

/**
 * Tenant-scoped permissions for Sprint 1. Later sprints add to this map; a role never gains a
 * permission implicitly. Platform roles (ops_reviewer, security_admin) are separate and are not
 * tenant memberships.
 */
export const Permission = {
  TenantRead: 'tenant.read',
  MembersRead: 'members.read',
  MembersManage: 'members.manage',
  AuditRead: 'audit.read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const MATRIX: Record<MembershipRole, ReadonlySet<Permission>> = {
  owner: new Set([Permission.TenantRead, Permission.MembersRead, Permission.MembersManage, Permission.AuditRead]),
  dispatcher: new Set([Permission.TenantRead, Permission.MembersRead]),
};

export function can(role: MembershipRole, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}
