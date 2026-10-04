import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_VIEWER, ANON_VIEWER, MEMBER_VIEWER, tonightStateFixture } from '@/app/_tonight/fixtures';
import { RoleTonight } from '@/app/_tonight/RoleTonight';
import { TonightView } from '@/app/_tonight/TonightView';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { ROLL_LABEL, THATS_ME } from '@/lib/tonight/copy';
import { kitViewer } from './viewer';

/** `That's me` navigates through the router (M19.3); nothing navigates in these tests. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** The kit's `?viewer=unlinked` (M14.42, scene-walk gap 15): the `That's me` list, reachable. */
const fixture = (state: 'filling' | 'balanced' | 'over-ten') =>
  tonightStateFixture(state, {
    realNames: true,
    now: Date.parse('2026-10-03T19:00:00Z'),
    mode: 'fearless',
    pool: 'demo',
    normalJustNow: false,
  });

describe('kitViewer', () => {
  it('keeps lead, anon and the default as they were', () => {
    const filling = fixture('filling');
    expect(kitViewer('lead', filling)).toBe(ADMIN_VIEWER);
    expect(kitViewer('anon', filling)).toBe(ANON_VIEWER);
    expect(kitViewer(undefined, filling)).toBe(filling.viewer);
  });

  it.each(['filling', 'balanced'] as const)(
    "?viewer=unlinked draws the That's me list on %s, minus the friend who already linked",
    (state) => {
      const shown = fixture(state);
      const members = shown.snapshot.lobby?.members ?? [];
      const viewer = kitViewer('unlinked', shown);
      expect(viewer).toEqual({ kind: 'unlinked', claimable: members.slice(1).map((m) => m.puuid) });
      render(<RoleTonight lobby={shown.snapshot.lobby} viewer={viewer} />);
      expect(screen.getAllByRole('button', { name: new RegExp(THATS_ME) })).toHaveLength(members.length - 1);
    },
  );

  it('?viewer=member (M14.78): a linked friend who is no admin sees no Roll and the waiting line naming admins', () => {
    const overTen = fixture('over-ten');
    // The fixture itself looks as an admin, which is why the kit needs the switch.
    expect(overTen.viewer).toBe(ADMIN_VIEWER);
    const viewer = kitViewer('member', overTen);
    expect(viewer).toBe(MEMBER_VIEWER);
    const { connection: _connection, ...props } = overTen;
    render(<TonightView {...props} viewer={viewer} group={ORIGINAL_GROUP} />);
    expect(screen.queryByRole('button', { name: ROLL_LABEL })).not.toBeInTheDocument();
    const [first, second] = props.admins ?? [];
    expect(
      screen.getAllByText(new RegExp(`Waiting on ${first} or ${second} to roll the teams`)).length,
    ).toBeGreaterThan(0);
  });
});
