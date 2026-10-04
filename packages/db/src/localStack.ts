import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Finding the Supabase CLI local stack, for integration tests only.
 *
 * Nothing in the app imports this: the API reads its URL and keys from the environment.
 * The keys the local stack prints are the same on every machine and are not secrets, but
 * they still are not written down in the repo — we ask the CLI for them.
 */

export interface LocalStack {
  /** e.g. `http://127.0.0.1:54321` */
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  /**
   * The HS256 secret the stack's PostgREST verifies JWTs with (M14.5: tests sign real
   * `authenticated` session tokens with it). Optional so callers that never sign one are unchanged.
   */
  jwtSecret?: string;
}

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fromEnv(): LocalStack | null {
  const url = process.env.SUPABASE_LOCAL_URL;
  const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return null;
  const jwtSecret = process.env.SUPABASE_LOCAL_JWT_SECRET;
  return jwtSecret ? { url, anonKey, serviceRoleKey, jwtSecret } : { url, anonKey, serviceRoleKey };
}

function fromCli(): LocalStack | null {
  let output: string;
  try {
    output = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // No CLI, no Docker, or the stack is not running. The caller skips.
    return null;
  }

  const values = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2]) values.set(match[1], match[2]);
  }

  const url = values.get('API_URL');
  const anonKey = values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) return null;
  const jwtSecret = values.get('JWT_SECRET');
  return jwtSecret ? { url, anonKey, serviceRoleKey, jwtSecret } : { url, anonKey, serviceRoleKey };
}

/**
 * The running local stack, or `null` when there is none. Integration tests skip on `null`
 * so `pnpm -r test` stays green on a machine without Docker.
 */
export async function resolveLocalStack(): Promise<LocalStack | null> {
  const stack = fromEnv() ?? fromCli();
  if (!stack) return null;

  try {
    const response = await fetch(`${stack.url}/rest/v1/`, {
      headers: { apikey: stack.anonKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    // Drain so the socket closes and vitest can exit.
    await response.text();
  } catch {
    return null;
  }

  return stack;
}
