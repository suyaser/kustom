import type { NextConfig } from 'next';

/**
 * Old addresses that moved under a group (M13.9 onward), as permanent (308) redirects that never
 * go away: months of WhatsApp and Discord messages carry them. Static ones only; `/` depends on
 * who is asking, so it is a page (`app/page.tsx`), and `/g/<gameId>` needs a lookup, so it is
 * `requirePageGroup`'s. Each later task adds the rows for the pages it moves (M13.10 to M13.14).
 */
export const legacyRedirects = [
  // The tonight share card became the original group's (M13.9).
  { source: '/og/tonight', destination: '/og/g/customs/tonight', permanent: true },
  // The More hub became the You tab (M14.7b, redesign/nav/proposal.md option A). Query carried.
  { source: '/g/:slug/more', destination: '/g/:slug/you', permanent: true },
  // The games list moved under the group (M14.16, M13.11's brief). Query carried; the page itself
  // re-spells the 1.0 `?p=` / `?queue=` as `?player=` / `?mode=`.
  { source: '/games', destination: '/g/customs/games', permanent: true },
  // Stats, Fun and 1v1 became one Stats tab with three segments (M14.17); the daily game moved
  // under the group. Query carried (`?window=`, `a`/`b`; `/fun`'s `?queue=` is read as the mode).
  { source: '/stats', destination: '/g/customs/stats', permanent: true },
  { source: '/fun', destination: '/g/customs/stats', permanent: true },
  { source: '/1v1', destination: '/g/customs/stats/1v1', permanent: true },
  { source: '/mystery', destination: '/g/customs/mystery', permanent: true },
  { source: '/g/:slug/fun', destination: '/g/:slug/stats', permanent: true },
  { source: '/g/:slug/1v1', destination: '/g/:slug/stats/1v1', permanent: true },
  // The board and the player page moved under the group (M14.15, M13.10). The query string
  // (`?window=`) carries through: Next appends it to a destination that names none.
  { source: '/leaderboard', destination: '/g/customs/leaderboard', permanent: true },
  { source: '/p/:puuid', destination: '/g/customs/p/:puuid', permanent: true },
  { source: '/og/p/:puuid', destination: '/og/g/customs/p/:puuid', permanent: true },
  // The 1.0 admin moved under the group and was retired (M14.22, M14.23). `/admin/login` stays a page.
  // `/admin/seasons` has no successor (M14.14): the admin home.
  { source: '/admin', destination: '/g/customs/admin', permanent: true },
  { source: '/admin/players', destination: '/g/customs/admin/members', permanent: true },
  { source: '/admin/tokens', destination: '/g/customs/admin/hosts', permanent: true },
  { source: '/admin/discord', destination: '/g/customs/admin/discord', permanent: true },
  { source: '/admin/games', destination: '/g/customs/admin/games', permanent: true },
  { source: '/admin/seasons', destination: '/g/customs/admin', permanent: true },
] as const;

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not a build artefact.
  // @customs/lcu is deliberately absent: the web app must never import the League client bridge.
  transpilePackages: ['@customs/core', '@customs/db'],
  typedRoutes: true,
  // Next writes its own AGENTS.md/CLAUDE.md into apps/web otherwise. This repo's agent
  // instructions live in the root CLAUDE.md and docs/; we do not want a second, generated set.
  agentRules: false,
  // M14.45: the Mode card on Tonight draws up to ten champion squares through the image optimizer
  // (a ~28 KB 120px Data Dragon PNG becomes a 48px WebP of a few KB). Only Data Dragon's champion
  // squares; the URLs are versioned, so a month of caching is safe.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'ddragon.leagueoflegends.com', pathname: '/cdn/*/img/champion/*' },
    ],
    minimumCacheTTL: 2_678_400,
  },
  async redirects() {
    return legacyRedirects.map((redirect) => ({ ...redirect }));
  },
};

export default nextConfig;
