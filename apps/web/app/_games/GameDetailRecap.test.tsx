import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiRecap } from '@/components/ai/AiRecap';
import { gameDetailFixture } from '@/lib/testing/gameDetailFixture';
import { GameDetail } from './GameDetail';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * M16.4 on the game page: the recap under the game header, above the receipt and the scoreboard,
 * never inside either; `Hide` for admins only, and a tap that takes the line away.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const RECAP = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000001',
  text: 'Nadia went 9 and 0 on Lee Sin as Red won in 31 minutes.',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function draw(canHide: boolean) {
  return render(
    <GameDetail
      game={gameDetailFixture()}
      backHref="/g/crew/games"
      recap={<AiRecap recap={RECAP} groupId={GROUP} canHide={canHide} hideRedirect="/g/crew/games/g1" />}
    />,
  );
}

describe('GameDetail: the AI recap', () => {
  it('sits under the header, above the receipt and the scoreboard, inside neither', () => {
    draw(false);
    const recap = screen.getByRole('region', { name: 'AI recap' });
    const receipt = screen.getByRole('region', { name: 'The odds were' });
    const scoreboard = screen.getByRole('region', { name: 'Scoreboard' });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(receipt.contains(recap)).toBe(false);
    expect(scoreboard.contains(recap)).toBe(false);
    expect(h1.compareDocumentPosition(recap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(recap.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(recap.compareDocumentPosition(scoreboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('members never see Hide', () => {
    draw(false);
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it("an admin's Hide posts the line and takes it off the page with the brief's confirmation", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, hidden: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    draw(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Hidden. It won't come back."));
    expect(screen.queryByText(RECAP.text)).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/ai/hide');
    expect(JSON.parse(String(init.body))).toEqual({ groupId: GROUP, lineId: RECAP.lineId });
  });

  it('keeps the line and says so when the hide did not go through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    draw(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't hide it. Try again."));
    expect(screen.getByText(RECAP.text)).toBeInTheDocument();
  });

  it('without a line the page is exactly the non-Premium page', () => {
    const props = { game: gameDetailFixture(), backHref: '/g/crew/games' };
    const plain = renderToStaticMarkup(<GameDetail {...props} />);
    expect(renderToStaticMarkup(<GameDetail {...props} recap={null} />)).toBe(plain);
    expect(
      renderToStaticMarkup(<GameDetail {...props} recap={<AiRecap recap={null} groupId={GROUP} />} />),
    ).toBe(plain);
    expect(plain).not.toContain('AI recap');
  });
});
