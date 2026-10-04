import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from '../publicClient';
import { loadGroupMode, loadGroupModeState } from './load';

const GROUP = '00000000-0000-0000-0000-0000000000aa';

/** A client whose one `group_modes` read answers `answer`; records what it was asked. */
function clientAnswering(answer: { data: unknown; error: { message: string } | null }) {
  const asked: { table?: string; columns?: string; groupId?: unknown } = {};
  const query = {
    select(columns: string) {
      asked.columns = columns;
      return query;
    },
    eq(_column: string, value: unknown) {
      asked.groupId = value;
      return query;
    },
    maybeSingle: async () => answer,
  };
  const client = {
    from(table: string) {
      asked.table = table;
      return query;
    },
  } as unknown as PublicClient;
  return { client, asked };
}

describe('loadGroupModeState', () => {
  it("reads the group's row by name, never select('*')", async () => {
    const { client, asked } = clientAnswering({
      data: { mode: 'normal', updated_at: '2026-10-03T20:00:00.000Z' },
      error: null,
    });
    expect(await loadGroupModeState(client, GROUP)).toEqual({
      mode: 'normal',
      since: '2026-10-03T20:00:00.000Z',
    });
    expect(asked).toEqual({
      table: 'group_modes',
      columns:
        'mode, updated_at, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override',
      groupId: GROUP,
    });
  });

  it('keeps an existing group on fearless exactly as stored (customs, and every group before 0030)', async () => {
    const { client } = clientAnswering({
      data: { mode: 'fearless', updated_at: '2026-09-01T00:00:00.000Z' },
      error: null,
    });
    expect(await loadGroupModeState(client, GROUP)).toEqual({
      mode: 'fearless',
      since: '2026-09-01T00:00:00.000Z',
    });
  });

  it('reads a group with no row as new, so normal (M14.46)', async () => {
    const { client } = clientAnswering({ data: null, error: null });
    expect(await loadGroupModeState(client, GROUP)).toEqual({ mode: 'normal', since: null });
    expect(await loadGroupMode(client, GROUP)).toBe('normal');
  });

  it('falls back to fearless on a failed read, so a hiccup never flips an existing group', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = clientAnswering({ data: null, error: { message: 'boom' } });
    expect(await loadGroupModeState(client, GROUP)).toEqual({ mode: 'fearless', since: null });
    expect(quiet).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it('falls back to fearless on a mode this build does not know (a newer deployment)', async () => {
    const { client } = clientAnswering({
      data: { mode: 'class', updated_at: '2026-10-03T20:00:00.000Z' },
      error: null,
    });
    expect(await loadGroupModeState(client, GROUP)).toEqual({
      mode: 'fearless',
      since: '2026-10-03T20:00:00.000Z',
    });
  });
});
