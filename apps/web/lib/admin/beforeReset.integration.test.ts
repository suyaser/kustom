import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eogBody, testGameId } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { modeNight, stackWithModes } from '@/lib/testing/modeNight';

/**
 * M15.13: admin Recording names a game from before the owner's Reset ratings (M14.18) as
 * `No · before the ratings reset`, never `Waiting to be counted`: the fold and the rebuild skip it
 * as `before-reset` for good. A scratch group (never `customs`, whose epoch other files read), one
 * backfilled game the fold has not run on, and the group's `ratings_since` moved past it.
 */

const stack = await stackWithModes(await resolveLocalStack());

if (stack === null) {
  describe.skip('Recording before a ratings reset against the local Supabase stack', () => {
    it('needs the local stack with 0032 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'br');
  const { listCapturedGames } = await import('./games');
  const { ratedLabel } = await import('./sectionCopy');

  beforeAll(night.setup);
  afterAll(night.teardown);

  it('a waiting game turns into `No · before the ratings reset` once the epoch passes it', async () => {
    const gameId = testGameId();
    night.gameIds.push(gameId);
    const { partyId: _none, ...body } = eogBody({
      gameId,
      puuids: night.ten,
      partyId: null,
      startedAt: '2026-08-01T19:00:00.000Z',
    });
    expect(await night.postEog({ ...body, source: 'backfill' })).toMatchObject({
      created: true,
      rated: false,
    });

    const labelNow = async () => {
      const rows = await listCapturedGames(night.db, { timeZone: 'Africa/Cairo', groupId: night.group.id });
      expect(rows).toHaveLength(1);
      return ratedLabel(rows[0]?.ratedReason ?? { kind: 'gate' });
    };
    expect(await labelNow()).toBe('Waiting to be counted');

    const reset = await night.db
      .from('groups')
      .update({ ratings_since: '2026-09-01T00:00:00.000Z' })
      .eq('id', night.group.id);
    if (reset.error) throw new Error(reset.error.message);
    expect(await labelNow()).toBe('No · before the ratings reset');
  });
}
