import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Real `auth.users` rows for the integration tests that need one (M13.5: `groups.created_by`,
 * `pairing_codes.auth_user_id` and `group_invites.rotated_by` are foreign keys into it). Tests
 * only: nothing in the app imports this.
 *
 * **Written through `psql` in the stack's database container, not the auth admin API.** On the
 * local stack (CLI 2.75) GoTrue's admin endpoints refuse both the legacy service-role JWT and the
 * `sb_secret_` key with `bad_jwt: signing method HS256 is invalid`, so `auth.admin.createUser`
 * cannot run here. A bare row with an id and an email is all a foreign key needs; nobody signs in
 * as these users -- the tests inject the session.
 *
 * `null` when Docker or the container is not there; the caller skips, like every other
 * integration file without the stack.
 */

const DB_PACKAGE_ROOT = fileURLToPath(new URL('../../../../packages/db/', import.meta.url));

export interface LocalAuthUsers {
  /** One `auth.users` row per email, ids returned in the same order. */
  create(emails: readonly string[]): string[];
  /**
   * One `auth.users` row that can really sign in with `grant_type=password` (M14.40: the session
   * refresh test needs a genuine access + refresh token pair from GoTrue, which only the token
   * endpoint hands out; the admin API is the part that refuses the key, not sign-in).
   */
  createWithPassword(email: string, password: string): string;
  remove(ids: readonly string[]): void;
}

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

/** Single-quoted SQL literal. The inputs are the tests' own strings, but quote them anyway. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function localAuthUsers(): LocalAuthUsers | null {
  const container = findDbContainer();
  if (container === null) return null;

  const psql = (sql: string): void => {
    execFileSync(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
      {
        input: sql,
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  };

  return {
    create(emails) {
      const ids = emails.map(() => randomUUID());
      if (ids.length === 0) return ids;
      const rows = emails
        .map(
          (email, i) =>
            `(${literal(ids[i] as string)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${literal(email)}, now(), now(), now())`,
        )
        .join(',\n');
      psql(
        `insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values\n${rows};`,
      );
      return ids;
    },
    createWithPassword(email, password) {
      const id = randomUUID();
      psql(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values (${literal(id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${literal(email)}, extensions.crypt(${literal(password)}, extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');`,
      );
      return id;
    },
    remove(ids) {
      if (ids.length === 0) return;
      psql(`delete from auth.users where id in (${ids.map(literal).join(', ')});`);
    },
  };
}
