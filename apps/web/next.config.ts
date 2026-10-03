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
] as const;

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not a build artefact.
  // @customs/lcu is deliberately absent: the web app must never import the League client bridge.
  transpilePackages: ['@customs/core', '@customs/db'],
  typedRoutes: true,
  // Next writes its own AGENTS.md/CLAUDE.md into apps/web otherwise. This repo's agent
  // instructions live in the root CLAUDE.md and docs/; we do not want a second, generated set.
  agentRules: false,
  async redirects() {
    return legacyRedirects.map((redirect) => ({ ...redirect }));
  },
};

export default nextConfig;
