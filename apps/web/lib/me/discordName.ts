import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { discordNameFromUser, supabaseSessionUser } from '../adminAuth';
import { createAuthClient, readOnlyCookieJar } from '../supabaseAuth';

/**
 * The signed-in session's Discord name, for the You tab's `Signed in as <name>` (design round 1, N7).
 * Display only, never an identity (`discordNameFromUser`). Null when nobody is signed in, the name
 * is missing, or the read fails: the page then drops the line rather than guessing.
 */
export const currentDiscordName: () => Promise<string | null> = cache(async () => {
  try {
    const store = await cookies();
    const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
    if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return null;
    const user = await supabaseSessionUser(createAuthClient(jar))();
    return user === null ? null : discordNameFromUser(user);
  } catch {
    return null;
  }
});
