import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThatsMe } from './ThatsMe';

/** M19.3: the welcome card is reached through the router (a soft navigation), never `location`. */
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const SEATS = [
  { puuid: 'u-lena', name: 'Lena' },
  { puuid: 'u-omar', name: 'TheSHADOWREAPER' },
];

afterEach(() => {
  vi.restoreAllMocks();
  router.push.mockClear();
});

describe("That's me on the game page (M14.34 contract)", () => {
  it('offers one button per claimable seat, each a no-JS form that lands on the welcome card', () => {
    render(<ThatsMe seats={SEATS} groupId="g-1" welcome="/g/x/you?welcome=1" />);
    const button = screen.getByRole('button', { name: "That's me: Lena" });
    const form = button.closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('action', '/api/me/link');
    expect(form).toHaveAttribute('method', 'post');
    expect(form.querySelector('input[name="redirectTo"]')).toHaveValue('/g/x/you?welcome=1');
    expect(form.querySelector('input[name="puuid"]')).toHaveValue('u-lena');
    expect(screen.getAllByRole('button', { name: /That's me/ })).toHaveLength(2);
  });

  it('draws nothing with no claimable seat', () => {
    const { container } = render(<ThatsMe seats={[]} groupId="g-1" welcome="/g/x/you?welcome=1" />);
    expect(container.innerHTML).toBe('');
  });

  it('links with JavaScript, then navigates to the welcome card through the router', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<ThatsMe seats={SEATS} groupId="g-1" welcome="/g/x/you?welcome=1" />);
    fireEvent.click(screen.getByRole('button', { name: "That's me: Lena" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/g/x/you?welcome=1'));
    // One press: the other seat's button is quiet while the first lands.
    fireEvent.click(screen.getByRole('button', { name: "That's me: TheSHADOWREAPER" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      groupId: 'g-1',
      puuid: 'u-lena',
    });
  });

  it("says the route's sentence when the link is refused", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Somebody already picked that player.' }), { status: 409 }),
    );
    render(<ThatsMe seats={SEATS} groupId="g-1" welcome="/g/x/you?welcome=1" />);
    fireEvent.click(screen.getByRole('button', { name: "That's me: Lena" }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Somebody already picked that player.');
  });
});
