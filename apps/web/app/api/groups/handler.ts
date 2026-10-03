import {
  createGroupRequestSchema,
  createGroupResponseSchema,
  GROUP_NAME_RULE,
  GROUP_SLUG_RULE,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { createGroup } from '@/lib/groups/create';
import { type SessionRouteOptions, withSession } from '@/lib/groups/sessionRoute';
import { jsonError, jsonOk } from '@/lib/http';

/**
 * `POST /api/groups { name, slug }` (M13.5): anyone signed in creates a group.
 *
 * A refusal of either field is a 400 whose `error` is product's sentence for it and whose
 * `issues` name the field (`name` or `slug`), so `/new` (M13.13) puts each sentence under the
 * field it belongs to. Both fields wrong: both issues, `error` the first. The slug is never
 * rewritten: `Abc` is the 400, not `abc`.
 *
 * 409 `That link is taken.` on a duplicate slug, nothing written. A second identical post is
 * exactly that 409: creating is not a retry-safe upsert, because the second caller may be
 * somebody else who wanted the same link.
 */
export function createGroupRoute(options: SessionRouteOptions = {}) {
  return withSession(async (request, { client, me }): Promise<NextResponse> => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, 'request body is not valid JSON');
    }

    const parsed = createGroupRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .filter((issue) => issue.path[0] === 'name' || issue.path[0] === 'slug')
        .map((issue) => ({
          path: String(issue.path[0]),
          message: issue.path[0] === 'name' ? GROUP_NAME_RULE : GROUP_SLUG_RULE,
        }));
      // A body that is not an object at all has no field to blame.
      const first = issues[0];
      if (first === undefined) return jsonError(400, 'request body failed validation');
      return jsonError(400, first.message, issues);
    }

    const result = await createGroup(client, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      createdBy: me.userId,
      playerId: me.player?.playerId ?? null,
    });
    if (!result.ok) return jsonError(result.status, result.error);

    return jsonOk(createGroupResponseSchema, { ok: true, ...result.value }, 201);
  }, options);
}
