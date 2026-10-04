import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { lineOf, sourceFiles, walkNodes } from './sourceScan';

/**
 * The prefetch rule (app-perf, 2026-10-04; `components/links/EntityLink.tsx`):
 *
 * 1. A link to an **entity page** (a player, a game, a 1v1 pair) never prefetches: it is
 *    `<EntityLink>` or a `next/link` `<Link>` with `prefetch={false}`. Lists print many of them, and
 *    every `router.refresh()` prefetched them all again, each running the target's layout and
 *    metadata on the server.
 * 2. A `<Link>` whose `href` is an opaque value (a bare identifier or a property, `href`,
 *    `props.home`, `item.href`) says which it is: an explicit `prefetch` (`"auto"` for navigation,
 *    `false` for an entity), or `<EntityLink>`. A reader cannot tell otherwise, and neither can
 *    this test.
 * 3. Everything else (literals, template paths, nav builders: tabs, chips, pagers, back links)
 *    keeps `next/link`'s default.
 *
 * Entity hrefs are recognised by how this codebase builds them: `groupHref(.., { page: 'player' |
 * 'game' })`, `playerHref` / `gameHref` (and `...For`), `playerPath`, `pickTwo...`, `playerPage`,
 * `links.game(` / `links.player(`, and literal `/p/` or `/games/${` paths.
 */

const ENTITY_HREF =
  /page:\s*'(player|game)'|\b(playerHref\w*|gameHref\w*|playerPath|pickTwo\w*|playerPage)\b|links\.(game|player)\(|\/p\/|\/games\/\$\{/;

/**
 * Files other lanes own and are fixing in their own branches (2026-10-04): Tonight (`tonight-perf`:
 * its cards, tape and team cards, and the Games list rows), Stats (`stats-perf`) and the mode panel
 * (the mode QA lane). Listed by file, never by directory, so a new file is checked from day one.
 * **Delete an entry once its lane has merged**; an entry that no longer has a violation is fine.
 */
const PENDING_OTHER_LANES = new Set([
  'app/_tonight/Cards.tsx',
  'app/_tonight/Strip.tsx',
  'app/_tonight/Tape.tsx',
  'app/_tonight/TeamCard.tsx',
  'app/_tonight/TonightView.tsx',
  'app/_games/GamesList.tsx',
  'app/_stats/parts.tsx',
  'app/_stats/records-parts.tsx',
  'app/_stats/StatsFrame.tsx',
  'app/_mode/ModeCard.tsx',
  'app/_mode/ModePanelBody.tsx',
]);

interface LinkUse {
  file: string;
  line: number;
  href: string;
  prefetch: string | null;
}

function linkUses(): LinkUse[] {
  const uses: LinkUse[] = [];
  for (const file of sourceFiles(['app', 'components'], ['.tsx'])) {
    if (!/from 'next\/link'/.test(file.text)) continue;
    for (const node of walkNodes(file.ast)) {
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) continue;
      if (node.tagName.getText(file.ast) !== 'Link') continue;
      let href = '';
      let prefetch: string | null = null;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(file.ast);
        const value = attribute.initializer;
        const text =
          value === undefined
            ? 'true'
            : ts.isJsxExpression(value)
              ? (value.expression?.getText(file.ast) ?? '')
              : value.getText(file.ast);
        if (name === 'href') href = text;
        if (name === 'prefetch') prefetch = text;
      }
      uses.push({ file: file.path, line: lineOf(file, node), href, prefetch });
    }
  }
  return uses;
}

/** `href`, `props.home`, `answer.jump.href`, `(href as Route)`: a value whose target is elsewhere. */
function isOpaque(href: string): boolean {
  const bare = href
    .replace(/\s+as\s+Route(<[^>]*>)?\s*$/, '')
    .replace(/^\((.*)\)$/, '$1')
    .trim();
  return /^[A-Za-z_$][\w$]*(\??\.[A-Za-z_$][\w$]*)*$/.test(bare);
}

describe('the prefetch rule', () => {
  const uses = linkUses().filter((use) => !PENDING_OTHER_LANES.has(use.file));

  it('finds the links it is meant to police', () => {
    expect(uses.length).toBeGreaterThan(20);
  });

  it('never prefetches an entity page from a <Link>', () => {
    const offenders = uses
      .filter((use) => ENTITY_HREF.test(use.href) && use.prefetch !== 'false')
      .map((use) => `${use.file}:${use.line} href={${use.href}} (use <EntityLink>)`);
    expect(offenders).toEqual([]);
  });

  it('makes every opaque href say how it prefetches', () => {
    const offenders = uses
      .filter((use) => isOpaque(use.href) && use.prefetch === null)
      .map(
        (use) =>
          `${use.file}:${use.line} href={${use.href}} (prefetch="auto" for navigation, <EntityLink> for a player or game)`,
      );
    expect(offenders).toEqual([]);
  });

  it('knows an entity href when it sees one', () => {
    for (const href of [
      "groupHref(group, { page: 'player', puuid })",
      'playerHref(row.puuid)',
      'gameHref(game.gameId)',
      'pickTwo(row.them.puuid)',
      'props.playerPage',
      'links.game(game.id) as Route',
      "'/g/customs/p/abc'",
    ]) {
      expect(ENTITY_HREF.test(href), href).toBe(true);
    }
    for (const href of [
      'allGamesHref',
      "windowHref(path, 'all-time')",
      'links.playerGames(puuid)',
      'backHref as Route',
    ]) {
      expect(ENTITY_HREF.test(href), href).toBe(false);
    }
    expect(isOpaque('href')).toBe(true);
    expect(isOpaque('answer.jump.href')).toBe(true);
    expect(isOpaque('backHref as Route')).toBe(true);
    expect(isOpaque('href(page - 1)')).toBe(false);
  });
});
