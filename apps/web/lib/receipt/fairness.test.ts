import { describe, expect, it } from 'vitest';
import { ADMINS_CAN, HOW_CAN_LINE } from '../landing/copy';
import { ADMIN_PRE_ROLL_POWERS, NOBODY_PICKED_BODY } from './copy';

/** M14.68 (design review): one fragment for the pre-roll powers, built into all three fairness lines. */
describe('the pre-roll powers in every fairness line (M14.68)', () => {
  it('the mode and Rated fragment is in the receipt, /how and the landing, and never after is nowhere', () => {
    expect(ADMIN_PRE_ROLL_POWERS).toBe('set the mode and whether a game is rated');
    for (const line of [NOBODY_PICKED_BODY, HOW_CAN_LINE, ADMINS_CAN]) {
      expect(line).toContain(ADMIN_PRE_ROLL_POWERS);
      expect(line).toContain('before its teams are rolled');
      expect(line).not.toMatch(/never after/);
    }
  });
});
