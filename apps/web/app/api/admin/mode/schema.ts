/**
 * `POST /api/admin/mode` (M14.29, M15.3; every action since M20.7, `/api/admin/mode/spin` merged
 * in). The schemas live in `@customs/db/schemas` (`modes.ts`) beside the one mode list; re-exported
 * here so the route's folder still names its boundary.
 */
export {
  type ModeLockState,
  type ModeRowState,
  type SetGroupModeRequest,
  type SetGroupModeResponse,
  setGroupModeRequestSchema,
  setGroupModeResponseSchema,
} from '@customs/db/schemas';
