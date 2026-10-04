/**
 * `POST /api/admin/members/role` (M13.4, owner-aware since M14.11): make a member of the group an
 * admin of it, or back. The schemas live in `@customs/db/schemas` (`members.ts`) with the other two
 * member writes; re-exported here so the route's folder still names its boundary.
 */
export {
  type MemberRoleRequest,
  type MemberRoleResponse,
  memberRoleRequestSchema,
  memberRoleResponseSchema,
} from '@customs/db/schemas';
