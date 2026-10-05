import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoidGame } from './VoidGame';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const props = {
  groupId: '00000000-0000-4000-8000-00000000000a',
  gameId: '10000000-0000-4000-8000-000000000001',
  redirectTo: '/g/crew/games/abc',
};

/** M23.1 / M23.3: the game page's admin button, free after tonight, disabled while the night is live. */
describe('VoidGame', () => {
  it.each([
    [null, 'Void game'],
    ['admin', 'Restore'],
    ['early-end', 'Rate it anyway'],
  ] as const)('void_reason %s: %s, enabled, no line', (voidReason, label) => {
    render(<VoidGame {...props} voidReason={voidReason} />);
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
    expect(screen.queryByText("Ratings can change after tonight's games.")).toBeNull();
  });

  it.each([
    [null, 'Void game'],
    ['early-end', 'Rate it anyway'],
  ] as const)(
    'while the guard holds (%s): %s is disabled, with the one line under it',
    (voidReason, label) => {
      render(<VoidGame {...props} voidReason={voidReason} held />);
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription("Ratings can change after tonight's games.");
    },
  );
});
