import { z } from 'zod';

/**
 * The two windows that close by themselves and post themselves (M5.10, M5.13).
 *
 * The same two words are three things and must stay one list: the `check` constraint on
 * `window_posts.kind` (`0011_window_posts.sql`), the `kind` in `GET /api/cron/window`'s
 * response, and two of the five `WindowKind`s the leaderboard is read through
 * (`apps/web/lib/board/window.ts`). The web app pins the third relationship with a
 * `satisfies`, so a sixth window or a renamed one is a typecheck failure and not a row this
 * table quietly refuses at 06:00 on a Sunday.
 *
 * Only the closed pair is here. `this-week`, `this-month` and `all-time` are windows a page is
 * read through; they never close, so nothing can ever have posted them.
 */
export const WINDOW_POST_KINDS = ['last-week', 'last-month'] as const;

export const windowPostKindSchema = z.enum(WINDOW_POST_KINDS);

export type WindowPostKind = z.infer<typeof windowPostKindSchema>;
