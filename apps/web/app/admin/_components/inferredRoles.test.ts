import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type AdminPlayerRow, formatInferredRoles } from '@/lib/admin/players';
import { InferredRoles } from './ui';

/**
 * `/admin/players`' Roles cell after M5.17: a sentence, and nothing to press.
 *
 * Two halves, and the second is the one that matters most. The first renders the cell in every
 * shape it has. The second reads the page's own source and fails if a role **control** ever
 * comes back — the acceptance check for this task is literally that the page has no form
 * control for a role, and a rendered-markup assertion on one component cannot see a `<select>`
 * somebody added three cells away.
 */

const source = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const page = source('../(dashboard)/players/page.tsx');
const ui = source('./ui.tsx');

function row(
  over: Partial<AdminPlayerRow>,
): Pick<AdminPlayerRow, 'mainRole' | 'secondaryRole' | 'rolesCounted'> {
  return { mainRole: null, secondaryRole: null, rolesCounted: 0, ...over };
}

describe('the inferred pair, as the admin reads it', () => {
  it('prints a pair, a lone main, the under-threshold case and the empty one', () => {
    expect(formatInferredRoles(row({ mainRole: 'support', secondaryRole: 'jungle', rolesCounted: 17 }))).toBe(
      'support · jungle · from 17 games',
    );
    // One role in the window: a second is never invented (M5.16).
    expect(formatInferredRoles(row({ mainRole: 'mid', rolesCounted: 4 }))).toBe('mid · from 4 games');
    // Under `config.roles.minGames`: flexible, and the count says why.
    expect(formatInferredRoles(row({ rolesCounted: 2 }))).toBe('flexible · from 2 games');
    expect(formatInferredRoles(row({}))).toBe('flexible · no games yet');
    // One game is one game, not "1 games".
    expect(formatInferredRoles(row({ rolesCounted: 1 }))).toBe('flexible · from 1 game');
  });

  it('renders the line as text, with the freshness stamp only as a title', () => {
    const html = renderToStaticMarkup(
      createElement(InferredRoles, {
        pair: formatInferredRoles(row({ mainRole: 'adc', secondaryRole: 'mid', rolesCounted: 9 })),
        inferredAt: '2026-09-10T21:14:00.000Z',
      }),
    );

    expect(html).toContain('adc · mid · from 9 games');
    expect(html).toContain('title="inferred 2026-09-10"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  });

  it('says nothing about freshness for a player nothing has been inferred for', () => {
    const html = renderToStaticMarkup(
      createElement(InferredRoles, { pair: formatInferredRoles(row({})), inferredAt: null }),
    );

    expect(html).toContain('flexible · no games yet');
    expect(html).not.toContain('title=');
  });
});

describe('the page has no role control left (M5.17)', () => {
  it('posts no set-roles form and renders no role select', () => {
    expect(page).toContain('<InferredRoles');
    for (const gone of ['set-roles', 'RoleSelect', 'mainRole', 'secondaryRole', 'main_role', '<select']) {
      expect([gone, page.includes(gone)]).toEqual([gone, false]);
    }
  });

  it('leaves the three controls that are still an admin’s to press', () => {
    for (const action of ['set-name', 'set-discord', 'set-admin']) {
      expect([action, page.includes(`value="${action}"`)]).toEqual([action, true]);
    }
  });

  it('has no backfill control left: backfill is on for every member (2026-10-03)', () => {
    for (const gone of ['set-backfill', 'backfillApprovedAt', 'backfillRequestedAt', 'Revoke']) {
      expect([gone, page.includes(gone)]).toEqual([gone, false]);
    }
  });

  it('has no role picker in the shared admin components either', () => {
    expect(ui).not.toContain('RoleSelect');
    expect(ui).not.toContain('<select');
  });
});
