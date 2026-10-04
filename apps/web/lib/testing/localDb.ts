import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `psql` as `postgres` inside the local stack's database container, for integration tests that
 * must read the catalog (PostgREST does not expose `pg_publication_tables`). Tests only: nothing in
 * the app imports this. `null` when Docker or the container is not there; the caller skips, like
 * every other integration file without the stack.
 *
 * Same lookup as `lib/testing/authUsers.ts` and `lib/ingest/applyRatings.integration.test.ts`
 * (the container is `supabase_db_<project_id>` from `packages/db/supabase/config.toml`).
 */

const DB_PACKAGE_ROOT = fileURLToPath(new URL('../../../../packages/db/', import.meta.url));

function findDbContainer(): string | null {
  try {
    const config = readFileSync(`${DB_PACKAGE_ROOT}supabase/config.toml`, 'utf8');
    const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
    if (!projectId) return null;
    const name = `supabase_db_${projectId}`;
    const running = execFileSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return running.split('\n').includes(name) ? name : null;
  } catch {
    return null;
  }
}

/** Runs `sql` and returns its unaligned, tuples-only output, trimmed; throws on any SQL error. */
export type LocalPsql = (sql: string) => string;

export function localPsql(): LocalPsql | null {
  const container = findDbContainer();
  if (container === null) return null;
  return (sql) =>
    execFileSync(
      'docker',
      ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'],
      { input: sql, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
}

/** The tables in the `supabase_realtime` publication, `schema.table`, sorted. */
export function publishedTables(psql: LocalPsql): string[] {
  const out = psql(
    "select schemaname || '.' || tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1",
  );
  return out === '' ? [] : out.split('\n');
}
