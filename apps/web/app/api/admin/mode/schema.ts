/**
 * `POST /api/admin/mode` (M14.29, extended by M15.3) and `POST /api/admin/mode/spin` (M15.3). The
 * schemas live in `@customs/db/schemas` (`modes.ts`) beside the one mode list; re-exported here so
 * the route's folder still names its boundary.
 */
export {
  type SetGroupModeRequest,
  type SetGroupModeResponse,
  type SpinModeRequest,
  setGroupModeRequestSchema,
  setGroupModeResponseSchema,
  spinModeRequestSchema,
} from '@customs/db/schemas';
