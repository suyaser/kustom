import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * `GET /api/me/lobbies/start/status?groupId=` (M19.16): where tonight's Start a lobby press is,
 * for a page that polls it while pending instead of re-rendering every 5 s (M19.17).
 */
export const startStatusQuerySchema = z.object({
  /** The group the page is showing. The session's player must be a member of it. */
  groupId: groupIdSchema,
});

export type StartStatusQuery = z.infer<typeof startStatusQuerySchema>;

export const startStatusResponseSchema = z
  .object({
    /**
     * The group's newest `create_lobby` of tonight: `pending` / `sent` while the host's client has
     * not answered, `done` once it acked (the lobby exists), `failed` for a refusal or the 60 s
     * expiry; `null` when nobody pressed tonight.
     */
    status: z.enum(['pending', 'sent', 'done', 'failed']).nullable(),
    /** Whose PC it went to, through the admin name chain. `null` exactly when `status` is. */
    host: z.object({ name: z.string().min(1) }).nullable(),
  })
  .refine((value) => (value.status === null) === (value.host === null), {
    message: 'host is present exactly when there is a press',
  });

export type StartStatusResponse = z.infer<typeof startStatusResponseSchema>;
