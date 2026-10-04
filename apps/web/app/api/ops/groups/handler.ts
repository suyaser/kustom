import { opsGroupsResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { supabaseSessionUser } from '@/lib/adminAuth';
import { ServerEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
import { listOpsGroups } from '@/lib/ops/groups';
import { authorizeOperator, type OperatorAuthResult } from '@/lib/ops/operator';
import { getServiceClient, type ServiceClient } from '@/lib/supabase';
import { createAuthClient, requestCookieJar } from '@/lib/supabaseAuth';
import { superAdminIds } from '@/lib/superAdmin';

/**
 * `GET /api/ops/groups` (M13.6 / M14.19): every group with slug, name, created at, member count,
 * admin count, last game at and whether a webhook is set. The operator only
 * (`SUPER_ADMIN_USER_IDS`); with the list unset or empty it is 403 for everyone.
 */

export interface OpsRouteOptions {
  getClient?: () => ServiceClient;
  /** Injection point for tests: the whole operator step. */
  authorize?: (request: Request) => Promise<OperatorAuthResult>;
}

function defaultAuthorize(request: Request): Promise<OperatorAuthResult> {
  return authorizeOperator({
    superAdminIds: superAdminIds(),
    resolveSessionUser: async () => {
      // Only built when the list is not empty: authorizeOperator refuses before calling this.
      return supabaseSessionUser(createAuthClient(requestCookieJar(request)))();
    },
  });
}

export function opsGroupsRoute(options: OpsRouteOptions = {}): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    try {
      const auth = await (options.authorize ?? defaultAuthorize)(request);
      if (!auth.ok) return jsonError(auth.status, auth.error);

      let client: ServiceClient;
      try {
        client = options.getClient ? options.getClient() : getServiceClient();
      } catch (error) {
        if (error instanceof ServerEnvError) {
          console.error(`ops route: ${error.message}`);
          return jsonError(500, 'server is not configured');
        }
        throw error;
      }

      return jsonOk(opsGroupsResponseSchema, { ok: true, groups: await listOpsGroups(client) });
    } catch (error) {
      console.error('ops route failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
