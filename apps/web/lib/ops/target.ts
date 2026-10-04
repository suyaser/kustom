/**
 * The one rule for "is this the local Supabase stack?", shared by the operator scripts that write
 * with the service role (`set-premium`, M16.2; `rebuild-ratings`, M14.27). Anything that is not
 * one of these hostnames is treated as hosted and needs `--hosted` on the command line.
 *
 * A hostname, not a URL prefix: `127.0.0.1.example.com` and `localhost.evil.dev` are not local.
 */
const LOCAL_STACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isLocalStackHostname(hostname: string): boolean {
  return LOCAL_STACK_HOSTNAMES.has(hostname);
}
