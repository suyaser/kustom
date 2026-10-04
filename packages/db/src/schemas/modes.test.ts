import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODE_IDS as CORE_MODE_IDS, config, RULE_OPTIONS, ruleKey } from '@customs/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_MODE,
  GROUP_MODES,
  groupModeRowSchema,
  groupModeSchema,
  isFearlessMode,
  lobbyLockRowSchema,
  MODE_CHOICES,
  MODE_IDS,
  NEW_GROUP_MODE,
  parseGroupMode,
  RULE_CHOICES,
  ruleCheckSchema,
  ruleChoiceOf,
  ruleColumnsOf,
  ruleModeOf,
  ruleOptionOf,
  setGroupModeRequestSchema,
  setGroupModeResponseSchema,
  spinModeRequestSchema,
} from './modes';

const MIGRATION = fileURLToPath(new URL('../../supabase/migrations/0024_group_mode.sql', import.meta.url));
const NEW_GROUPS_NORMAL = fileURLToPath(
  new URL('../../supabase/migrations/0030_new_groups_start_normal.sql', import.meta.url),
);
const MODE_OF_THE_NIGHT = fileURLToPath(
  new URL('../../supabase/migrations/0032_mode_of_the_night.sql', import.meta.url),
);
const GROUP = '00000000-0000-0000-0000-000000000001';

describe('groupModeSchema', () => {
  it('knows exactly the two M14 modes', () => {
    expect(GROUP_MODES).toEqual(['normal', 'fearless']);
    expect(groupModeSchema.safeParse('normal').success).toBe(true);
    expect(groupModeSchema.safeParse('fearless').success).toBe(true);
  });

  it("refuses a mode M14 does not know (M15's class) and the wrong case", () => {
    expect(groupModeSchema.safeParse('class').success).toBe(false);
    expect(groupModeSchema.safeParse('Fearless').success).toBe(false);
    expect(groupModeSchema.safeParse('').success).toBe(false);
    expect(groupModeSchema.safeParse(null).success).toBe(false);
  });

  it('falls back to fearless (what every group before 0030 is on) when the mode cannot be read', () => {
    expect(DEFAULT_GROUP_MODE).toBe('fearless');
  });

  it('a new group starts on normal (M14.46)', () => {
    expect(NEW_GROUP_MODE).toBe('normal');
  });
});

describe('parseGroupMode', () => {
  it('reads a stored mode and falls back to the default for anything else', () => {
    expect(parseGroupMode('normal')).toBe('normal');
    expect(parseGroupMode('fearless')).toBe('fearless');
    expect(parseGroupMode('class')).toBe('fearless');
    expect(parseGroupMode(undefined)).toBe('fearless');
    expect(parseGroupMode(null)).toBe('fearless');
  });
});

describe('isFearlessMode', () => {
  it('is true for fearless only', () => {
    expect(isFearlessMode('fearless')).toBe(true);
    expect(isFearlessMode('normal')).toBe(false);
  });
});

describe('setGroupModeRequestSchema', () => {
  it('accepts a group and a known mode, with or without redirectTo', () => {
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP, mode: 'normal' }).success).toBe(true);
    expect(
      setGroupModeRequestSchema.safeParse({ groupId: GROUP, mode: 'fearless', redirectTo: '/g/customs' })
        .success,
    ).toBe(true);
  });

  it('accepts a rule choice, the Rated switch and Spin, from JSON or a form (M15.3)', () => {
    expect(setGroupModeRequestSchema.parse({ groupId: GROUP, mode: 'class:Tank' }).mode).toBe('class:Tank');
    expect(setGroupModeRequestSchema.parse({ groupId: GROUP, mode: 'region' }).mode).toBe('region');
    expect(setGroupModeRequestSchema.parse({ groupId: GROUP, rated: false }).rated).toBe(false);
    expect(setGroupModeRequestSchema.parse({ groupId: GROUP, rated: 'true' }).rated).toBe(true);
    expect(setGroupModeRequestSchema.parse({ groupId: GROUP, spin: 'true' }).spin).toBe(true);
    expect(spinModeRequestSchema.safeParse({ groupId: GROUP }).success).toBe(true);
  });

  it('refuses two actions at once, and a false spin', () => {
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP, mode: 'normal', rated: true }).success).toBe(
      false,
    );
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP, spin: true, rated: true }).success).toBe(
      false,
    );
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP, spin: false }).success).toBe(false);
  });

  it('refuses an unknown mode, a missing mode and a missing group', () => {
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP, mode: 'class' }).success).toBe(false);
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP, mode: 'class:Fighter' }).success).toBe(
      false,
    );
    expect(setGroupModeRequestSchema.safeParse({ groupId: GROUP }).success).toBe(false);
    expect(setGroupModeRequestSchema.safeParse({ mode: 'normal' }).success).toBe(false);
    expect(setGroupModeRequestSchema.safeParse({ groupId: 'customs', mode: 'normal' }).success).toBe(false);
  });
});

describe('setGroupModeResponseSchema', () => {
  it('is ok, the mode now, and whether it changed', () => {
    expect(setGroupModeResponseSchema.parse({ ok: true, mode: 'normal', changed: true })).toEqual({
      ok: true,
      mode: 'normal',
      changed: true,
    });
    expect(setGroupModeResponseSchema.safeParse({ ok: true, mode: 'class', changed: false }).success).toBe(
      false,
    );
  });
});

describe('0024_group_mode.sql', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('seeds public.modes with exactly the schema list', () => {
    const seed = /insert into public\.modes \(id\) values ([^;]+?)\s*on conflict/.exec(sql);
    expect(seed).not.toBeNull();
    const ids = [...(seed?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(ids).toEqual([...GROUP_MODES]);
  });

  it("defaulted a group's mode to fearless, which 0030 changes for new groups only", () => {
    expect(sql).toContain(`mode       text        not null default 'fearless'`);
  });
});

describe('0030_new_groups_start_normal.sql', () => {
  const sql = readFileSync(NEW_GROUPS_NORMAL, 'utf8');
  /** The statements, without the header comments. */
  const body = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('is one transaction', () => {
    expect(body.trim().startsWith('begin;')).toBe(true);
    expect(body.trim().endsWith('commit;')).toBe(true);
  });

  it("sets the column default and the trigger's insert to the new-group mode", () => {
    expect(body).toContain(`alter column mode set default '${NEW_GROUP_MODE}'`);
    expect(body).toContain(
      `insert into public.group_modes (group_id, mode) values (new.id, '${NEW_GROUP_MODE}')`,
    );
  });

  it('stamps a game whose group has no row with the new-group mode', () => {
    expect(body).toContain(`new.mode := coalesce(new.mode, '${NEW_GROUP_MODE}');`);
  });

  it('never updates or deletes an existing row', () => {
    expect(body).not.toMatch(/\bupdate\s+public\./i);
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
  });
});

describe('the M15.3 lists agree with core', () => {
  it('MODE_IDS is core list, and the choices are the standing modes then every rule option', () => {
    expect([...MODE_IDS]).toEqual([...CORE_MODE_IDS]);
    expect([...MODE_CHOICES]).toEqual(['normal', 'fearless', ...RULE_OPTIONS.map(ruleKey)]);
    expect([...RULE_CHOICES]).toEqual(RULE_OPTIONS.map(ruleKey));
  });

  it('maps every rule choice to core RuleOption and back', () => {
    for (const choice of RULE_CHOICES) {
      const rule = ruleOptionOf(choice);
      expect(rule).not.toBeNull();
      expect(rule === null ? null : ruleChoiceOf(rule)).toBe(choice);
    }
    expect(ruleOptionOf('normal')).toBeNull();
    expect(ruleOptionOf('fearless')).toBeNull();
  });

  it('maps a mode to the rule columns and back', () => {
    for (const mode of [
      { id: 'class', tag: 'Mage' },
      { id: 'region', blue: 'ionia', red: 'shadow-isles' },
      { id: 'mirror' },
    ] as const) {
      expect(ruleModeOf(ruleColumnsOf(mode))).toEqual(mode);
    }
    expect(ruleColumnsOf({ id: 'fearless' })).toEqual({
      rule: null,
      classTag: null,
      regionBlue: null,
      regionRed: null,
    });
    expect(ruleModeOf({ rule: 'class', classTag: 'Fighter', regionBlue: null, regionRed: null })).toBeNull();
    expect(ruleModeOf({ rule: 'region', classTag: null, regionBlue: 'ionia', regionRed: null })).toBeNull();
  });
});

describe('the M15.3 row and JSON schemas', () => {
  it('parses an anon group_modes row and refuses a rule as the standing mode', () => {
    const row = {
      group_id: GROUP,
      mode: 'fearless',
      pending_rule: 'class',
      pending_class_tag: 'Tank',
      rated_override: null,
      version: 4,
      updated_at: '2026-10-04T18:00:00Z',
    };
    expect(groupModeRowSchema.safeParse(row).success).toBe(true);
    expect(groupModeRowSchema.safeParse({ ...row, mode: 'class' }).success).toBe(false);
  });

  it('parses a lobby lock, with no lock all null', () => {
    const none = {
      lock_mode: null,
      lock_rule: null,
      lock_class_tag: null,
      lock_region_blue: null,
      lock_region_red: null,
      lock_rated: null,
      lock_version: null,
      locked_at: null,
    };
    expect(lobbyLockRowSchema.safeParse(none).success).toBe(true);
    expect(
      lobbyLockRowSchema.safeParse({
        ...none,
        lock_mode: 'normal',
        lock_rule: 'region',
        lock_region_blue: 'ionia',
        lock_region_red: 'noxus',
        lock_rated: false,
        lock_version: 2,
        locked_at: '2026-10-04T18:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('parses the stored check, sides and lanes', () => {
    expect(
      ruleCheckSchema.safeParse({
        kind: 'sides',
        blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
        red: { side: 200, verdict: 'broke', broke: [222], unknown: [799] },
      }).success,
    ).toBe(true);
    expect(
      ruleCheckSchema.safeParse({
        kind: 'lanes',
        lanes: [{ lane: 'mid', verdict: 'broke', blue: 103, red: 134 }],
        kept: 4,
      }).success,
    ).toBe(true);
    expect(ruleCheckSchema.safeParse({ kind: 'sides', blue: { side: 100 } }).success).toBe(false);
  });
});

describe('0032_mode_of_the_night.sql', () => {
  const sql = readFileSync(MODE_OF_THE_NIGHT, 'utf8');
  const body = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('is one transaction', () => {
    expect(body.trim().startsWith('begin;')).toBe(true);
    expect(body.trim().endsWith('commit;')).toBe(true);
  });

  it("seeds the three rules with core's default rated fact", () => {
    const seed = /insert into public\.modes \(id, rated_default\) values([^;]+?)on conflict/.exec(body);
    const rows = [...(seed?.[1] ?? '').matchAll(/\('([a-z]+)', (true|false)\)/g)].map((m) => [
      m[1],
      m[2] === 'true',
    ]);
    expect(rows).toEqual([
      ['class', config.modes.ratedDefault.class],
      ['region', config.modes.ratedDefault.region],
      ['mirror', config.modes.ratedDefault.mirror],
    ]);
    // The standing modes keep the column default, true, as core says.
    expect(config.modes.ratedDefault.normal && config.modes.ratedDefault.fearless).toBe(true);
    expect(body).toContain('add column rated_default boolean not null default true');
  });

  it('never reshapes 0024: no update, delete, drop, or alter of an existing column', () => {
    expect(body).not.toMatch(/\bupdate\s+public\./i);
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
    expect(body).not.toMatch(/\bdrop\s+(column|table|constraint|trigger)\b/i);
    expect(body).not.toMatch(/alter column/i);
  });

  it('keeps pending_set_by out of the anon grant (0029 rule)', () => {
    const grant = /grant select \(([^)]*)\) on public\.group_modes/.exec(body)?.[1] ?? '';
    expect(grant).toContain('pending_rule');
    expect(grant).toContain('version');
    expect(grant).not.toContain('pending_set_by');
    expect(body).toMatch(/grant select \([^)]*lock_mode[^)]*\) on public\.lobbies to anon, authenticated/);
  });

  it('defaults every stored game to rated, so nothing rated before moves on a rebuild', () => {
    expect(body).toContain('add column rated boolean not null default true');
  });
});
