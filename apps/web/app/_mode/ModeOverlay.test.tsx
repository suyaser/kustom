import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { MODE_CARD_LINK_ID } from '@/lib/mode/hrefs';
import { Announcer } from '../_tonight/Announcer';

/**
 * The routed mode panel's overlay (M14.30; 05-design.md 8.6): Escape and Close go Back, only the
 * topmost layer closes, focus is trapped and returned, the page behind is inert while open and
 * released after, the scroll lock is released, and live regions are never made inert.
 */

const back = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ back }) }));

const { ModeOverlay } = await import('./ModeOverlay');

afterEach(() => {
  back.mockClear();
});

function Page({ open, nested = false }: { open: boolean; nested?: boolean }) {
  return (
    <>
      <main>
        <a id={MODE_CARD_LINK_ID} href="/g/customs/mode">
          Fearless
        </a>
      </main>
      {open ? (
        <ModeOverlay headingId="t" title="Fearless | Kustom">
          <h2 id="t" tabIndex={-1}>
            Fearless
          </h2>
          <button type="button">First</button>
          <details>
            <summary>Banned</summary>
            <button type="button">Hidden inside the closed fold</button>
          </details>
          {nested ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button type="button">Open layer</button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Layer</AlertDialogTitle>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <button type="button">Last</button>
          )}
        </ModeOverlay>
      ) : null}
    </>
  );
}

describe('the mode panel overlay', () => {
  it('is a modal dialog labelled by its heading, focused on the heading, with the title set', () => {
    document.title = 'Tonight';
    render(<Page open />);
    const dialog = screen.getByRole('dialog', { name: 'Fearless' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Fearless' })).toHaveFocus();
    expect(document.title).toBe('Fearless | Kustom');
  });

  it('makes the page behind inert and locks the scroll, and releases both on close, returning focus', () => {
    const link = (() => {
      const { rerender } = render(<Page open={false} />);
      const a = document.getElementById(MODE_CARD_LINK_ID) as HTMLElement;
      a.focus();
      rerender(<Page open />);
      return { a, rerender };
    })();
    const appRoot = link.a.closest('body > div') as HTMLElement;
    expect(appRoot.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
    link.rerender(<Page open={false} />);
    expect(appRoot.inert).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    expect(link.a).toHaveFocus();
  });

  it('leaves an element someone else made inert alone, before and after', () => {
    const other = document.createElement('div');
    other.inert = true;
    document.body.appendChild(other);
    const { rerender } = render(<Page open />);
    expect(other.inert).toBe(true);
    rerender(<Page open={false} />);
    expect(other.inert).toBe(true);
    other.remove();
  });

  it('never makes a live region inert: the announcer is still heard with the panel open', async () => {
    render(
      <>
        <Announcer text="Teams are set." mode="fearless" />
        <Page open />
      </>,
    );
    const region = await waitFor(() => {
      const found = [...document.body.children].find((child) => child.hasAttribute('aria-live'));
      if (found === undefined) throw new Error('not portalled yet');
      return found as HTMLElement;
    });
    expect(region.inert).toBeFalsy();
  });

  it('closes on Escape and on Close, both by going Back', () => {
    render(<Page open />);
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Fearless' }), { key: 'Escape' });
    expect(back).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside, skipping what a closed fold hides', () => {
    render(<Page open />);
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('Escape in a layer above the panel closes that layer only', async () => {
    render(<Page open nested />);
    fireEvent.click(screen.getByRole('button', { name: 'Open layer' }));
    const layer = await screen.findByRole('alertdialog', { name: 'Layer' });
    await act(async () => {
      fireEvent.keyDown(layer, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Fearless' })).toBeInTheDocument();
  });
});
