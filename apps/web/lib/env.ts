import { z } from 'zod';
import { DEFAULT_NIGHT_TIME_ZONE, isValidTimeZone } from './night';
import { ServerEnvError } from './publicEnv';

/**
 * Server-side environment, read once per process and validated with zod like every other
 * boundary. Nothing in here is ever imported from a client component: `SUPABASE_SERVICE_ROLE_KEY`
 * bypasses RLS, so it must never reach the browser bundle.
 *
 * Every variable named here is listed in the repo's `.env.example`.
 */
const serverEnvSchema = z.object({
  /** Same URL the browser uses; only the key differs. */
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** Bypasses RLS. Server only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * Optional. When set, the first request of a process promotes this PUUID to admin through
   * `public.bootstrap_admin()` (idempotent). See `lib/bootstrapAdmin.ts`.
   */
  BOOTSTRAP_ADMIN_PUUID: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  /**
   * Optional. The Discord user id (snowflake) to link to `BOOTSTRAP_ADMIN_PUUID` the first
   * time a process needs it. Without it the bootstrap admin exists but cannot sign in: the
   * gate matches a session to a player through `players.discord_id`, and the PUUID that seeds
   * the first admin has no Discord link yet. See `lib/bootstrapAdmin.ts`.
   */
  BOOTSTRAP_ADMIN_DISCORD_ID: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  /**
   * The timezone a night is measured in (M2.5). An IANA name; a night runs 06:00 to 06:00
   * there, which is what "games tonight" counts over for the sit-out rotation. Defaults to
   * where the group is; a deployment somewhere else sets its own.
   */
  CUSTOMS_NIGHT_TZ: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : DEFAULT_NIGHT_TIME_ZONE))
    .refine(isValidTimeZone, { message: 'must be an IANA timezone name' }),
  /**
   * Optional. Bearer token for `GET /api/cron/sweep`, the scheduled half of the two-hour idle
   * sweep. Unset, that route answers 503 and nothing else changes: the sweep also runs at the
   * start of every companion post, which is what covers a group that is playing (M2.5).
   */
  CRON_SECRET: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Reads and validates the server environment.
 *
 * Throws {@link ServerEnvError} rather than returning a half-configured object: a route that
 * cannot reach the database must answer 500, not write somewhere unexpected.
 */
export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    BOOTSTRAP_ADMIN_PUUID: source.BOOTSTRAP_ADMIN_PUUID,
    BOOTSTRAP_ADMIN_DISCORD_ID: source.BOOTSTRAP_ADMIN_DISCORD_ID,
    CUSTOMS_NIGHT_TZ: source.CUSTOMS_NIGHT_TZ,
    CRON_SECRET: source.CRON_SECRET,
  });

  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ServerEnvError(`missing or invalid environment: ${names}`);
  }

  return parsed.data;
}

/**
 * The Discord application the web server talks to for `Connect Discord` (M14.20): OAuth2
 * `webhook.incoming`. The **same application** as Discord sign-in -- the values are copied from
 * `SUPABASE_AUTH_DISCORD_CLIENT_ID` / `SUPABASE_AUTH_DISCORD_SECRET`, which only the Supabase CLI
 * reads (hosted sign-in is configured in the Supabase dashboard, not on Vercel). Server only.
 *
 * Separate from {@link readServerEnv}: a deployment without it still runs every other route, and
 * `Connect Discord` sends the admin back to the page with the paste fallback.
 */
const discordOAuthEnvSchema = z.object({
  DISCORD_CLIENT_ID: z
    .string()
    .trim()
    .regex(/^\d{17,20}$/, 'must be the application id'),
  DISCORD_CLIENT_SECRET: z.string().trim().min(1),
  /**
   * Optional. The exact callback URL registered in the Discord developer portal. Unset, it is
   * `<site origin>/api/admin/discord/callback`. Pin it when the origin can differ (localhost vs
   * 127.0.0.1): Discord compares it character for character, on authorize and on the exchange.
   */
  DISCORD_REDIRECT_URI: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type DiscordOAuthEnv = z.infer<typeof discordOAuthEnvSchema>;

/** The Discord OAuth environment, or null when it is not configured (logged once by the caller). */
export function readDiscordOAuthEnv(source: NodeJS.ProcessEnv = process.env): DiscordOAuthEnv | null {
  const parsed = discordOAuthEnvSchema.safeParse({
    DISCORD_CLIENT_ID: source.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: source.DISCORD_CLIENT_SECRET,
    DISCORD_REDIRECT_URI: source.DISCORD_REDIRECT_URI,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The Anthropic API key Kustom Premium's AI lines are written with (M16.3). Server only, never
 * `NEXT_PUBLIC_`, and read by `lib/ai/client.ts` alone. Set on Vercel **Production** only, so a
 * preview deploy never spends.
 *
 * Separate from {@link readServerEnv}, and optional: unset (or blank), every AI path is silently
 * absent -- no model call, no line, no error -- and everything else runs as before.
 */
const anthropicEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1),
});

export type AnthropicEnv = z.infer<typeof anthropicEnvSchema>;

/** The Anthropic environment, or null when no key is set (AI off, quietly). */
export function readAnthropicEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): AnthropicEnv | null {
  const parsed = anthropicEnvSchema.safeParse({ ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY });
  return parsed.success ? parsed.data : null;
}

/**
 * Which model provider writes Kustom Premium's AI lines (the user's 2026-10-04 move to DeepSeek).
 * `deepseek` is DeepSeek's own API (`DEEPSEEK_API_KEY`); `anthropic` is Claude
 * (`ANTHROPIC_API_KEY`), kept as the fallback. Both server only, never `NEXT_PUBLIC_`.
 */
export const AI_PROVIDERS = ['deepseek', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * The provider used when `AI_PROVIDER` is unset and both keys are present: `deepseek` since the
 * owner's final call of 2026-10-04 (Claude stays the fallback when only its key is set).
 */
export const PREFERRED_AI_PROVIDER: AiProvider = 'deepseek';

const aiProviderSchema = z.enum(AI_PROVIDERS);
const apiKeySchema = z.string().trim().min(1);

export interface AiEnv {
  provider: AiProvider;
  apiKey: string;
}

/**
 * The AI environment, or null when AI is off (quietly). In order:
 * - `AI_PROVIDER` set to `deepseek` or `anthropic`: that provider, and only with its own key; no
 *   key, AI is off (an explicit choice never falls over to the other provider's bill).
 * - `AI_PROVIDER` set to anything else: AI is off (a typo must not pick a provider).
 * - `AI_PROVIDER` unset or blank: {@link PREFERRED_AI_PROVIDER} if its key is set, else the other
 *   one if its key is set, else off. So with both keys set DeepSeek writes, and removing a key
 *   falls back to the other.
 */
export function readAiEnv(source: Readonly<Record<string, string | undefined>> = process.env): AiEnv | null {
  const keyOf = (provider: AiProvider): string | null => {
    const parsed = apiKeySchema.safeParse(
      provider === 'deepseek' ? source.DEEPSEEK_API_KEY : source.ANTHROPIC_API_KEY,
    );
    return parsed.success ? parsed.data : null;
  };
  const raw = source.AI_PROVIDER?.trim() ?? '';
  if (raw !== '') {
    const chosen = aiProviderSchema.safeParse(raw);
    if (!chosen.success) return null;
    const apiKey = keyOf(chosen.data);
    return apiKey === null ? null : { provider: chosen.data, apiKey };
  }
  const other: AiProvider = PREFERRED_AI_PROVIDER === 'deepseek' ? 'anthropic' : 'deepseek';
  for (const provider of [PREFERRED_AI_PROVIDER, other]) {
    const apiKey = keyOf(provider);
    if (apiKey !== null) return { provider, apiKey };
  }
  return null;
}

/**
 * The provider whose models the feature table names: the one {@link readAiEnv} would call, or,
 * with no usable key (AI off, tests), an explicit `AI_PROVIDER`, else the preference. Never a key.
 */
export function aiProviderOf(source: Readonly<Record<string, string | undefined>> = process.env): AiProvider {
  const env = readAiEnv(source);
  if (env !== null) return env.provider;
  const chosen = aiProviderSchema.safeParse(source.AI_PROVIDER?.trim());
  return chosen.success ? chosen.data : PREFERRED_AI_PROVIDER;
}

// `ServerEnvError` lives in `./publicEnv` (M14.44) so the browser's zod-free reader can throw the
// same class; re-exported here for every server caller.
export { ServerEnvError } from './publicEnv';

/**
 * The public half of the environment: what the Supabase Auth client needs. Separate from
 * {@link readServerEnv} because the anon key is only required by the admin session path —
 * the companion API has worked without it since M1.5 and must keep working.
 *
 * `NEXT_PUBLIC_*` values are inlined by the bundler only where they are written as literal
 * `process.env.X` member expressions, which is why {@link processAuthEnvSource} spells all
 * three out instead of handing `process.env` around.
 */
const authEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** Safe in the browser: RLS decides what it can read. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /**
   * Optional. The origin OAuth comes back to (`https://customs.example`). Unset, the origin
   * is taken from the request, which is right on Vercel and in `next dev`.
   */
  NEXT_PUBLIC_SITE_URL: z
    .url()
    .optional()
    .transform((value) => (value ? value.replace(/\/$/, '') : undefined)),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

function processAuthEnvSource(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };
}

/** Reads the auth environment. Throws {@link ServerEnvError} when it is incomplete. */
export function readAuthEnv(source: Record<string, string | undefined> = processAuthEnvSource()): AuthEnv {
  const parsed = authEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ServerEnvError(`missing or invalid environment: ${names}`);
  }

  return parsed.data;
}
