import { describe, expect, it } from 'vitest';
import { type ChecklistFacts, deriveChecklist } from './checklist';
import {
  ROW_DISCORD_WHY,
  ROW_FIRST_GAME_WHY,
  ROW_INVITE_TODO_DETAIL,
  ROW_INVITE_WHY,
  ROW_KUSTOM_WHY,
} from './homeCopy';

/** `Get your group ready` flips on its data, row by row (M14.22 acceptance 6; STRATEGY 3.1, 3.2). */

const NOW = new Date('2026-10-03T21:00:00.000Z');
const context = { now: NOW, groupLink: 'kustom.gg/g/friday-five' };

const fresh: ChecklistFacts = {
  discord: { webhookSet: false, testPostAt: null, testPostError: null },
  members: 1,
  hosts: [],
  hasGame: false,
};

const row = (facts: ChecklistFacts, key: string) =>
  deriveChecklist(facts, context).rows.find((r) => r.key === key);

describe('the setup checklist', () => {
  it('a fresh group: created is done with its link, Discord, Kustom and invite are to do, no first game', () => {
    const checklist = deriveChecklist(fresh, context);
    expect(checklist.ready).toBe(false);
    // M14.43: Kustom before the invite (players also join by playing with the group's Kustom).
    expect(checklist.rows.map((r) => [r.key, r.state])).toEqual([
      ['created', 'done'],
      ['discord', 'to-do'],
      ['kustom', 'to-do'],
      ['invite', 'to-do'],
    ]);
    expect(checklist.rows[0]?.detail).toBe('Group created. Your link: kustom.gg/g/friday-five');
  });

  it('Discord: done only once a test post landed; a stored webhook alone, or a failed test, is to do', () => {
    expect(row(fresh, 'discord')).toMatchObject({ state: 'to-do', why: ROW_DISCORD_WHY });
    const saved = { ...fresh, discord: { webhookSet: true, testPostAt: null, testPostError: null } };
    expect(row(saved, 'discord')).toMatchObject({ state: 'to-do', why: ROW_DISCORD_WHY });
    const failed = {
      ...fresh,
      discord: { webhookSet: true, testPostAt: null, testPostError: 'Unknown Webhook' },
    };
    expect(row(failed, 'discord')).toMatchObject({ state: 'to-do', why: 'Unknown Webhook' });
    const tested = {
      ...fresh,
      discord: { webhookSet: true, testPostAt: '2026-10-03T20:55:00.000Z', testPostError: null },
    };
    expect(row(tested, 'discord')).toMatchObject({ state: 'done', detail: 'test post sent 5 minutes ago' });
  });

  it('Invite: just you until one other person is a member', () => {
    expect(row(fresh, 'invite')).toMatchObject({
      state: 'to-do',
      detail: ROW_INVITE_TODO_DETAIL,
      why: ROW_INVITE_WHY,
    });
    expect(row({ ...fresh, members: 0 }, 'invite')).toMatchObject({ state: 'to-do' });
    expect(row({ ...fresh, members: 2 }, 'invite')).toMatchObject({
      state: 'done',
      detail: '2 people in the group',
    });
  });

  it('Kustom: to do with no host, waiting for a host never seen, done with the latest one seen', () => {
    expect(row(fresh, 'kustom')).toMatchObject({ state: 'to-do', why: ROW_KUSTOM_WHY });
    const waiting = { ...fresh, hosts: [{ label: 'Kustom (paired)', account: null, lastSeenAt: null }] };
    expect(row(waiting, 'kustom')).toMatchObject({ state: 'waiting', detail: null, why: null });
    const seen = {
      ...fresh,
      hosts: [
        { label: 'Old laptop', account: null, lastSeenAt: '2026-10-01T20:00:00.000Z' },
        { label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T19:00:00.000Z' },
        { label: null, account: null, lastSeenAt: null },
      ],
    };
    expect(row(seen, 'kustom')).toMatchObject({
      state: 'done',
      detail: 'Kustom seen on Hana PC, 2 hours ago',
    });
    const unlabelled = {
      ...fresh,
      hosts: [{ label: null, account: null, lastSeenAt: '2026-10-03T20:59:30.000Z' }],
    };
    expect(row(unlabelled, 'kustom')).toMatchObject({ detail: 'Kustom seen on Unnamed PC, just now' });
    // M14.50: a pairing's fixed label is named after its account, never `This PC`.
    const paired = {
      ...fresh,
      hosts: [{ label: 'Kustom (paired)', account: 'Hana', lastSeenAt: '2026-10-03T20:57:00.000Z' }],
    };
    expect(row(paired, 'kustom')).toMatchObject({ detail: 'Kustom seen on Hana’s PC, 3 minutes ago' });
  });

  it('Kustom reopens when every host is revoked (the facts carry live hosts only)', () => {
    const seen = {
      ...fresh,
      hosts: [{ label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T19:00:00.000Z' }],
      hasGame: true,
    };
    expect(deriveChecklist(seen, context).ready).toBe(true);
    const revoked = { ...seen, hosts: [] };
    expect(deriveChecklist(revoked, context).ready).toBe(false);
    expect(row(revoked, 'kustom')).toMatchObject({ state: 'to-do' });
  });

  it('First game: shown once Kustom is seen, done when a game is recorded, and that makes the group ready', () => {
    const seen = {
      ...fresh,
      hosts: [{ label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T19:00:00.000Z' }],
    };
    expect(row(seen, 'first-game')).toMatchObject({ state: 'to-do', why: ROW_FIRST_GAME_WHY });
    expect(deriveChecklist(seen, context).ready).toBe(false);
    expect(row({ ...seen, hasGame: true }, 'first-game')).toMatchObject({ state: 'done' });
    // Rows 2 and 3 are recommended, not required.
    expect(deriveChecklist({ ...seen, hasGame: true }, context).ready).toBe(true);
  });

  it('no first-game row while Kustom is only waiting, even with games in history', () => {
    const waiting = { ...fresh, hosts: [{ label: null, account: null, lastSeenAt: null }], hasGame: true };
    expect(row(waiting, 'first-game')).toBeUndefined();
    expect(deriveChecklist(waiting, context).ready).toBe(false);
  });

  it('never lists a row before the row it waits on (M14.43): invite and first game come after Kustom', () => {
    const seen = {
      ...fresh,
      hosts: [{ label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T20:50:00.000Z' }],
    };
    for (const facts of [fresh, seen, { ...seen, hasGame: true, members: 4 }]) {
      const keys = deriveChecklist(facts, context).rows.map((r) => r.key);
      const at = (key: string) => keys.indexOf(key as (typeof keys)[number]);
      expect(at('kustom')).toBeLessThan(at('invite'));
      if (at('first-game') !== -1) expect(at('kustom')).toBeLessThan(at('first-game'));
      expect(keys[0]).toBe('created');
    }
    expect(deriveChecklist(seen, context).rows.map((r) => r.key)).toEqual([
      'created',
      'discord',
      'kustom',
      'invite',
      'first-game',
    ]);
  });
});
