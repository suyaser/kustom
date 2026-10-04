/**
 * The two public Supabase values a **browser** needs, read with no zod (M14.44).
 *
 * `lib/env.ts` validates the server environment with zod, which is right on the server and
 * expensive in a phone's bundle: the tonight page's live channel reaching `readAuthEnv` once put
 * zod and every schema on Tonight (`redesign/quality/REPORT.md` P2). The two checks it needs here
 * are a parseable http(s) URL and a non-empty key, and they are the same checks `readAuthEnv`
 * makes with `z.url()` and `z.string().min(1)`.
 *
 * `NEXT_PUBLIC_*` values are inlined by the bundler only where they are written as literal
 * `process.env.X` member expressions, which is why the default source spells both out.
 */

/** Thrown when the process is not configured to talk to Supabase. */
export class ServerEnvError extends Error {
  override name = 'ServerEnvError';
}

export interface PublicSupabaseEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  /** Safe in the browser: RLS decides what it can read. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
}

function processPublicSource(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
  };
}

function isHttpUrl(value: string | undefined): value is string {
  if (value === undefined || value === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The Supabase URL and anon key. Throws {@link ServerEnvError} naming what is missing. */
export function readPublicSupabaseEnv(
  source: Record<string, string | undefined> = processPublicSource(),
): PublicSupabaseEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL;
  const key = source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [
    ...(isHttpUrl(url) ? [] : ['NEXT_PUBLIC_SUPABASE_URL']),
    ...(key !== undefined && key.length > 0 ? [] : ['NEXT_PUBLIC_SUPABASE_ANON_KEY']),
  ];
  if (missing.length > 0 || url === undefined || key === undefined) {
    throw new ServerEnvError(`missing or invalid environment: ${missing.join(', ')}`);
  }
  return { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key };
}
