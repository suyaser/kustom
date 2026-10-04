import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MainTabKey } from '@/lib/nav';
import { TabFrame } from './TabFrame';

/**
 * The five pending frames (05-design.md 5.9a, M19.14 sketches). jsdom has no layout, so the
 * "heights" are the token classes each block carries; one class list covers 375 and 1280 (the
 * `md:` / `lg:` variants are in it), and the snapshot pins both.
 */

const TABS: MainTabKey[] = ['tonight', 'board', 'games', 'stats', 'you'];

/** Height, visibility-by-width and grid classes: what decides the frame's shape at 375 and 1280. */
const SHAPE = /^(?:(?:first|md|lg):)*(?:h-|max-h-|hidden$|flex$|grid-cols-|w-)/;

function shape(tab: MainTabKey) {
  const { container } = render(<TabFrame tab={tab} />);
  const blocks = [...container.querySelectorAll('[data-slot="frame"]')].map((el) => {
    const rows = [...el.children].map((row) =>
      row.className
        .split(' ')
        .filter((c) => SHAPE.test(c))
        .join(' '),
    );
    return {
      frame: el.getAttribute('data-frame'),
      shape: el.className.split(' ').filter((c) => SHAPE.test(c)),
      // Every row carries the same classes; a `first:` height is the first row's (a team header).
      rows: rows.length === 0 ? undefined : `${rows.length} × ${rows[0]}`,
    };
  });
  return { container, blocks };
}

describe('TabFrame', () => {
  it.each(TABS)('draws the %s frame from Frame blocks at token heights (375 and 1280)', (tab) => {
    const { blocks } = shape(tab);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks).toMatchSnapshot();
  });

  it.each(TABS)('%s: shapes only — no words, no motion, no amber, no side colour, all aria-hidden', (tab) => {
    const { container } = render(<TabFrame tab={tab} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('data-tab', tab);
    expect(root.textContent).toBe('');
    const classes = [...container.querySelectorAll('*')]
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ');
    expect(classes).not.toMatch(/animate-|transition|primary|blue|red|side-|live/);
    expect(classes).toMatch(/max-h-\[calc\(100svh/); // first screen only
    for (const block of container.querySelectorAll('[data-slot="frame"]')) {
      expect(block.className).toContain('bg-card');
      expect(block.className).toContain('border-border');
    }
  });

  it('draws Tonight in the balanced shape: the strip, two team cards of 54 + 5 × 64, the rail from 1024', () => {
    const { blocks } = shape('tonight');
    expect(blocks.map((b) => b.frame)).toEqual(['strip', 'team-card', 'team-card', 'rail']);
    expect(blocks[1]?.rows).toBe('6 × first:h-(--thead-h) h-(--seat-min-h)');
    expect(blocks[3]?.shape).toEqual(['hidden', 'lg:flex']);
  });
});

/**
 * 5.9a: no `loading.tsx` and no new `<Suspense>` under the group routes. A streamed boundary puts the
 * page in a hidden node only JavaScript swaps in, so a no-JS first load would lose the page and its
 * forms (Tonight's Roll and That's me, Stats' 1v1 GET form, You's sign-in and sign-out).
 */
describe('no streamed boundary on a route a person lands on', () => {
  const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const GROUP = path.join(WEB, 'app', '(group)');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  const files = walk(GROUP);

  it('has no loading.tsx', () => {
    expect(files.filter((file) => /loading\.[jt]sx?$/.test(file)).map((f) => path.relative(WEB, f))).toEqual(
      [],
    );
  });

  it('has no <Suspense> in a page or layout but the join notice, which has no fallback to stream', () => {
    const offenders = files
      .filter((file) => /\/(page|layout|template)\.tsx$/.test(file))
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8');
        const boundaries = source.match(/<Suspense\b[^>]*>/g) ?? [];
        return boundaries
          .filter((tag) => !(tag.includes('fallback={null}') && source.includes('<JoinedNotice />')))
          .map((tag) => `${path.relative(WEB, file)}: ${tag}`);
      });
    expect(offenders).toEqual([]);
  });
});
