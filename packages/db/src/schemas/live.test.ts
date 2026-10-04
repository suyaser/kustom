import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Database } from '../types';
import {
  GROUP_LIVE_KIND_PRECEDENCE,
  GROUP_LIVE_KINDS,
  groupLiveFilter,
  groupLiveKindSchema,
  groupLiveRowSchema,
} from './live';

const MIGRATION = fileURLToPath(new URL('../../supabase/migrations/0037_group_live.sql', import.meta.url));
const GROUP = '00000000-0000-0000-0000-000000000001';

describe('group_live kinds (M19.9)', () => {
  it('are exactly the migration check list, in the same order', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const check = /constraint group_live_kind check \(kind in \(([^)]*)\)\)/.exec(sql)?.[1];
    expect(check).toBeDefined();
    const fromSql = (check ?? '').split(',').map((word) => word.trim().replace(/^'|'$/g, ''));
    expect(fromSql).toEqual([...GROUP_LIVE_KINDS]);
  });

  it('rank every kind exactly once', () => {
    expect([...GROUP_LIVE_KIND_PRECEDENCE].sort()).toEqual([...GROUP_LIVE_KINDS].sort());
    expect(GROUP_LIVE_KIND_PRECEDENCE[0]).toBe('game');
    expect(GROUP_LIVE_KIND_PRECEDENCE.at(-1)).toBe('mode');
  });

  it('refuse a word outside the list', () => {
    expect(groupLiveKindSchema.safeParse('lobby').success).toBe(true);
    expect(groupLiveKindSchema.safeParse('players').success).toBe(false);
    expect(groupLiveKindSchema.safeParse('Lobby').success).toBe(false);
  });
});

describe('groupLiveRowSchema', () => {
  const row = { group_id: GROUP, version: 3, kind: 'game', changed_at: '2026-10-04T20:15:00.123+00:00' };

  it('reads the four columns', () => {
    expect(groupLiveRowSchema.parse(row)).toEqual(row);
  });

  it('refuses a fifth column: the row carries no player or lobby data, ever', () => {
    expect(groupLiveRowSchema.safeParse({ ...row, lobby_id: GROUP }).success).toBe(false);
    expect(groupLiveRowSchema.safeParse({ ...row, player_id: GROUP }).success).toBe(false);
  });

  it('refuses a negative or fractional version and a missing column', () => {
    expect(groupLiveRowSchema.safeParse({ ...row, version: -1 }).success).toBe(false);
    expect(groupLiveRowSchema.safeParse({ ...row, version: 1.5 }).success).toBe(false);
    const { changed_at: _dropped, ...partial } = row;
    expect(groupLiveRowSchema.safeParse(partial).success).toBe(false);
  });

  it('matches the generated table type column for column', () => {
    type Columns = keyof Database['public']['Tables']['group_live']['Row'];
    const columns: Record<Columns, true> = { group_id: true, version: true, kind: true, changed_at: true };
    expect(Object.keys(groupLiveRowSchema.shape).sort()).toEqual(Object.keys(columns).sort());
  });

  it('builds the one filter a page subscribes with', () => {
    expect(groupLiveFilter(GROUP)).toBe(`group_id=eq.${GROUP}`);
  });
});
