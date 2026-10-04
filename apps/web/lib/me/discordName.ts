import 'server-only';
import { cache } from 'react';
import { currentLiveSession } from '../session/currentLiveSession';

/**
 * The signed-in session's Discord name, for the You tab's `Signed in as <name>` (design round 1, N7).
 * Display only, never an identity: it is the verified token's `user_metadata` name, which the user
 * can write, so it only ever names them on their own screen. Read from the same live-session lookup
 * the page already made (`lib/session/liveSession.ts`), so it costs no round trip of its own. Null
 * when nobody is signed in, the name is missing, or the read fails: the page then drops the line
 * rather than guessing.
 */
export const currentDiscordName: (groupId?: string) => Promise<string | null> = cache(
  async (groupId?: string) => {
    try {
      // Pass the page's group so this rides on the lookup the page already made for it.
      const live = await currentLiveSession(groupId ?? null);
      return live.kind === 'signed-in' ? live.discordName : null;
    } catch {
      return null;
    }
  },
);
