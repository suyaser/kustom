import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import AdminLayout from '@/app/admin/layout';
import RootError from '@/app/error';
import GlobalError from '@/app/global-error';
import RootNotFound from '@/app/not-found';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { RIOT_NOTICE } from '@/lib/shellCopy';
import { BareShell } from './BareShell';
import { ErrorView } from './ErrorView';
import { GroupNotFound } from './GroupNotFound';
import { Shell } from './Shell';

/**
 * M14.8 acceptance 1: Riot's developer-policy notice is in every route's rendered HTML, verbatim,
 * including a 404 and the error pages.
 *
 * Walked in two halves, without a server: (1) every `page.tsx` under `app/` sits under one of the
 * frames below (so a new route outside them fails here), and (2) each frame, server-rendered, carries
 * the notice.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/g/customs' }));

// Vitest runs from `apps/web` (its config's directory); jsdom gives no `file:` import.meta.url.
const APP = join(process.cwd(), 'app');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'api' || entry === 'og' ? [] : pages(path);
    return entry === 'page.tsx' ? [relative(APP, path)] : [];
  });
}

const source = (path: string) => readFileSync(join(APP, path), 'utf8');

/**
 * The frames that draw a footer, as the layout files that mount them. A layout counts only if its
 * source both imports the frame and renders it; the frame's own source must render the footer that
 * renders `RiotNotice`; and the rendered-frame tests below prove that footer carries the text.
 */
const FRAME_LAYOUTS: readonly { layout: string; frame: string; imports: RegExp; renders: RegExp }[] = [
  {
    layout: '(group)/g/[slug]/layout.tsx',
    frame: 'shell',
    imports: /import \{ Shell \} from '@\/components\/shell\/Shell';/,
    renders: /<Shell\b/,
  },
  {
    // Kustom's own pages (M14.24): `/` (the landing page, or a member's redirect), `/about`,
    // `/how`, `/download`.
    layout: '(kustom)/layout.tsx',
    frame: 'bare',
    imports: /import \{ BareShell \} from '@\/components\/shell\/BareShell';/,
    renders: /<BareShell\b/,
  },
  {
    layout: 'new/layout.tsx',
    frame: 'bare',
    imports: /import \{ BareShell \} from '@\/components\/shell\/BareShell';/,
    renders: /<BareShell\b/,
  },
  {
    // `/ops` (M14.23): the operator's list of every group.
    layout: 'ops/layout.tsx',
    frame: 'bare',
    imports: /import \{ BareShell \} from '@\/components\/shell\/BareShell';/,
    renders: /<BareShell\b/,
  },
  {
    layout: 'join/layout.tsx',
    frame: 'bare',
    imports: /import \{ BareShell \} from '@\/components\/shell\/BareShell';/,
    renders: /<BareShell\b/,
  },
  {
    layout: 'admin/layout.tsx',
    frame: 'admin',
    imports: /import \{ RiotNotice \} from '@\/components\/shell\/RiotNotice';/,
    renders: /<RiotNotice\b/,
  },
];

/** Every `layout.tsx` governing a page, nearest first, the root layout excluded (it draws no footer). */
function layoutsOf(page: string): string[] {
  const found: string[] = [];
  for (let dir = dirname(page); dir !== '.'; dir = dirname(dir)) {
    const layout = join(dir, 'layout.tsx');
    if (existsSync(join(APP, layout))) found.push(layout);
  }
  return found;
}

/** The frame that draws a page's footer, decided by the layouts that actually govern it. */
function frameOf(page: string): string | null {
  if (page.startsWith('(dev)/')) return 'dev-only';
  for (const layout of layoutsOf(page)) {
    const rule = FRAME_LAYOUTS.find((candidate) => candidate.layout === layout);
    if (rule !== undefined) return rule.frame;
  }
  return null;
}

const decode = (html: string) =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

const html = (element: ReactElement) => decode(renderToStaticMarkup(element));

const error = Object.assign(new Error('boom'), { digest: 'a1b2c3' });

const FRAMES: Record<string, () => ReactElement> = {
  shell: () => (
    <PageGroupProvider group={ORIGINAL_GROUP}>
      <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
        <p>page</p>
      </Shell>
    </PageGroupProvider>
  ),
  bare: () => (
    <BareShell>
      <p>page</p>
    </BareShell>
  ),
  admin: () => (
    <AdminLayout>
      <p>page</p>
    </AdminLayout>
  ),
  'group 404': () => (
    <PageGroupProvider group={ORIGINAL_GROUP}>
      <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
        <GroupNotFound />
      </Shell>
    </PageGroupProvider>
  ),
  'site 404 and unknown group': () => <RootNotFound />,
  'group error': () => (
    <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
      <ErrorView error={error} reset={() => {}} back={{ label: 'Back', href: '/g/customs' }} />
    </Shell>
  ),
  'root error': () => <RootError error={error} reset={() => {}} />,
  'global error': () => <GlobalError error={error} reset={() => {}} />,
};

describe("Riot's notice on every page (M14.8)", () => {
  it('has a footer frame for every page route, through a layout that governs it', () => {
    const found = pages(APP);
    expect(found.length).toBeGreaterThan(10);
    for (const page of found) expect(frameOf(page), page).not.toBeNull();
  });

  it('mounts each frame from its layout, and each frame renders the footer that renders the notice', () => {
    for (const rule of FRAME_LAYOUTS) {
      const text = source(rule.layout);
      expect(text, rule.layout).toMatch(rule.imports);
      expect(text, rule.layout).toMatch(rule.renders);
    }
    // The two shells the layouts import draw their footers, and the footer draws the notice.
    expect(source('../components/shell/Shell.tsx')).toMatch(/<Footer\b/);
    expect(source('../components/shell/BareShell.tsx')).toMatch(/<Footer\b/);
    expect(source('../components/shell/Footer.tsx')).toMatch(/<RiotNotice\b/);
    expect(source('../components/shell/BareShell.tsx')).toMatch(/<Footer \/>/);
  });

  it('exempts only dev pages that are a 404 in production', () => {
    // `/` is a real page since M14.24 (the landing page, in the bare shell): no exemption.
    expect(existsSync(join(APP, 'page.tsx'))).toBe(false);
    for (const page of pages(APP).filter((path) => path.startsWith('(dev)/'))) {
      expect(source(page), page).toMatch(/if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
    }
  });

  it.each(Object.keys(FRAMES))('is in the rendered HTML of the %s frame, verbatim', (name) => {
    const render = FRAMES[name];
    if (render === undefined) throw new Error(name);
    expect(html(render())).toContain(RIOT_NOTICE);
  });

  it('names Kustom and quotes the policy text', () => {
    expect(RIOT_NOTICE).toBe(
      "Kustom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.",
    );
  });
});
