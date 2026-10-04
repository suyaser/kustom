import { describe, expect, it } from 'vitest';
import { COMMAND_ERRORS, commandStatusAt } from './queue';

describe('commandStatusAt (fix-start-pending)', () => {
  const EXPIRES = '2026-10-04T20:01:00.000Z';
  const at = (iso: string) => new Date(iso);

  it('reports a live row as stored until its expires_at', () => {
    for (const status of ['pending', 'sent'] as const) {
      expect(
        commandStatusAt({ status, error: null, expires_at: EXPIRES }, at('2026-10-04T20:00:59.999Z')),
      ).toEqual({
        status,
        error: null,
      });
    }
  });

  it('reports a live row at or past its expires_at as failed / expired, the sweep’s comparison', () => {
    for (const status of ['pending', 'sent'] as const) {
      for (const now of [EXPIRES, '2026-10-04T23:00:00.000Z']) {
        expect(commandStatusAt({ status, error: null, expires_at: EXPIRES }, at(now))).toEqual({
          status: 'failed',
          error: COMMAND_ERRORS.expired,
        });
      }
    }
  });

  it('never rewrites a settled row, however old', () => {
    const late = at('2026-10-05T03:00:00.000Z');
    expect(commandStatusAt({ status: 'acked', error: null, expires_at: EXPIRES }, late)).toEqual({
      status: 'acked',
      error: null,
    });
    expect(
      commandStatusAt({ status: 'failed', error: 'already_in_lobby: x', expires_at: EXPIRES }, late),
    ).toEqual({ status: 'failed', error: 'already_in_lobby: x' });
  });

  it('leaves a row with an unreadable expires_at as stored', () => {
    expect(commandStatusAt({ status: 'pending', error: null, expires_at: 'nope' }, at(EXPIRES))).toEqual({
      status: 'pending',
      error: null,
    });
  });
});
