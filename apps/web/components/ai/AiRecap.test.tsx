import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiRecap } from './AiRecap';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** M16.4: the recap caption, its label and tap text, and who sees `Hide`. */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const LINE = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000001',
  text: 'Nadia went 9/0 on Lee Sin.',
};

describe('AiRecap', () => {
  it('renders nothing at all without a line', () => {
    const { container } = render(<AiRecap recap={null} groupId={GROUP} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders no markup while a line may still land', () => {
    const { container } = render(<AiRecap recap={{ kind: 'waiting' }} groupId={GROUP} />);
    expect(container.innerHTML).toBe('');
  });

  it('labels the line `AI recap` with its tap text, as plain text', () => {
    render(<AiRecap recap={{ ...LINE, text: '<b>Nadia</b> won.' }} groupId={GROUP} />);
    const region = screen.getByRole('region', { name: 'AI recap' });
    expect(region).toHaveTextContent('<b>Nadia</b> won.');
    expect(screen.getByText('AI recap')).toHaveAttribute(
      'title',
      'Written by AI from the numbers on this page. Every number in it is checked against the game before it shows up.',
    );
    expect(region.querySelector('b')).toBeNull();
  });

  it('never shows Hide to a member', () => {
    render(<AiRecap recap={LINE} groupId={GROUP} />);
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('shows Hide to an admin, posting to the admin route for this line', () => {
    render(<AiRecap recap={LINE} groupId={GROUP} canHide hideRedirect="/g/crew/games/g1" />);
    const button = screen.getByRole('button', { name: 'Hide' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/api/admin/ai/hide');
    expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toEqual({
      groupId: GROUP,
      lineId: LINE.lineId,
      redirectTo: '/g/crew/games/g1',
    });
  });
});
