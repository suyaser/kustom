import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiRecap } from '@/components/ai/AiRecap';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { TITLE_FINISHED } from '@/lib/receipt/copy';
import { tonightStateFixture } from './fixtures';
import { TonightView } from './TonightView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * M16.4 on Tonight's finished poster: the recap sits under the result and above the receipt,
 * never inside it, and a poster with no recap is byte-for-byte the poster without Premium.
 */

const NOW = Date.parse('2026-10-20T20:30:00Z');
const RECAP = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000001',
  text: 'Nadia went 9 and 0 on Lee Sin as Red won in 31 minutes.',
};

function finished() {
  const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW });
  return fixture;
}

describe('Tonight poster: the AI recap slot', () => {
  it('shows the labelled line above the receipt, never inside it', () => {
    render(
      <TonightView
        {...finished()}
        group={ORIGINAL_GROUP}
        renderedAt={NOW}
        aiRecap={<AiRecap recap={RECAP} groupId={ORIGINAL_GROUP.id} />}
      />,
    );
    const recap = screen.getByRole('region', { name: 'AI recap' });
    const receipt = screen.getByRole('region', { name: TITLE_FINISHED });
    expect(recap).toHaveTextContent(RECAP.text);
    expect(receipt.contains(recap)).toBe(false);
    expect(recap.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Under the result headline.
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.compareDocumentPosition(recap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No Hide on Tonight (brief 1.5: game page and player page).
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('without a line the poster is exactly the non-Premium poster', () => {
    const props = { ...finished(), group: ORIGINAL_GROUP, renderedAt: NOW };
    const plain = renderToStaticMarkup(<TonightView {...props} />);
    expect(renderToStaticMarkup(<TonightView {...props} aiRecap={null} />)).toBe(plain);
    expect(
      renderToStaticMarkup(
        <TonightView {...props} aiRecap={<AiRecap recap={null} groupId={ORIGINAL_GROUP.id} />} />,
      ),
    ).toBe(plain);
    expect(
      renderToStaticMarkup(
        <TonightView
          {...props}
          aiRecap={<AiRecap recap={{ kind: 'waiting' }} groupId={ORIGINAL_GROUP.id} />}
        />,
      ),
    ).toBe(plain);
    expect(plain).not.toContain('AI recap');
    expect(plain).not.toContain('Premium');
  });
});
