import { puuidSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { internalPathSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/me/lobbies/start` (M4.2's press, moved onto the `/api/me/*` class by M4.13): open
 * tonight's lobby on somebody's client.
 *
 * **The body decides nothing.** No lobby name, no password, no mode, no host: each one is a
 * step, and this product's claim is that there are none. The name and the password are
 * generated (`lib/lobbyStart.ts`), the mode is the companion's own read of the client's
 * custom-queue list, and the host is picked from who has a companion up. The only field is
 * where a browser form goes back to.
 */
export const startLobbyRequestSchema = z.object({
  /**
   * Where an HTML form post is sent back to, when it is not `/` — the tonight page's
   * no-JavaScript fallback names `/` (M3.4) and `/admin`'s one button names `/admin`.
   * Re-validated by `safeNextPath` before it is used,
   * so a body can never turn this route into an open redirect. A JSON caller may send it and it
   * changes nothing.
   */
  redirectTo: internalPathSchema.optional(),
});

export type StartLobbyRequest = z.infer<typeof startLobbyRequestSchema>;

export const startLobbyResponseSchema = z.object({
  ok: z.literal(true),
  /**
   * The `companion_commands` row that was written. One per press: a second press while it is
   * live is a 409 and no second row, which is what makes a double tap on a slow phone harmless.
   */
  commandId: z.uuid(),
  /**
   * Whose client was picked. The page names them while the command is pending (`Opening a lobby
   * on <Name>'s PC…`) and then stops mentioning it — nobody chose them and nobody needs to know
   * afterwards.
   */
  host: z.object({
    playerId: z.uuid(),
    puuid: puuidSchema,
    /** Already through the admin name chain: display name, else Riot ID, else a puuid fragment. */
    name: z.string().min(1),
  }),
  /** `Customs 09 Sep #2`. `#n` is which lobby of the night this is. */
  lobbyName: z.string().min(1).max(30),
  /** Four digits. Not a secret: it goes in the Discord embed and on the tonight page. */
  lobbyPassword: z.string().regex(/^\d{4}$/),
  /** Which lobby of the night this is, so a caller can say so without parsing the name. */
  cycle: z.number().int().min(1),
  /** 60 s out. Past it, nothing was created and the page says so. */
  expiresAt: z.iso.datetime({ offset: true }),
});

export type StartLobbyResponse = z.infer<typeof startLobbyResponseSchema>;
