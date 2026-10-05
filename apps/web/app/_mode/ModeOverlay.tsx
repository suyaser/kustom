'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PANEL_CLOSE, PANEL_CRUMB_MODE, PANEL_CRUMB_TONIGHT } from '@/lib/mode/copy';
import { MODE_CARD_LINK_ID } from '@/lib/mode/hrefs';

/**
 * The mode panel over Tonight (M14.30; 05-design.md 8.5.2 and 8.6, the one routed panel): opened
 * by a soft navigation from the Mode card or the answer band, which the `@panel/(.)mode` slot
 * intercepts. Full screen below 1024, a dialog at 1024 and up over a scrim.
 *
 * 8.6's rules: `role="dialog"`, `aria-modal`, labelled by its heading; focus moves to the heading
 * (not the find box, which would pop the phone keyboard), is trapped inside, and returns to the
 * trigger on close; Back, Escape and `Close` all close it (`router.back()`: it was pushed from
 * Tonight); the page behind is `inert` and does not scroll. Portalled to `<body>` so the rest of
 * the document can be made inert as one set of siblings.
 */
export function ModeOverlay({
  headingId,
  title,
  lobbyLabel = null,
  children,
}: {
  headingId: string;
  /** M22.6 (14.5): with 2+ lobbies live, the panel's lobby: `Tonight · Ana's lobby · Mode` (< 1024 without `Tonight`). */
  lobbyLabel?: string | null | undefined;
  /** `Fearless | Kustom`, the document title while the panel is open (8.5.1). */
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousTitle = document.title;
    document.title = title;
    const root = frame.current?.closest('[data-slot="mode-overlay-root"]') ?? null;
    const behind = [...document.body.children].filter(
      (element): element is HTMLElement =>
        // Already inert (someone else's dialog): not ours to set, so not ours to release.
        element instanceof HTMLElement && element !== root && !keepsLive(element) && !element.inert,
    );
    for (const element of behind) element.inert = true;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    document.getElementById(headingId)?.focus();

    return () => {
      for (const element of behind) element.inert = false;
      html.style.overflow = overflow;
      document.title = previousTitle;
      const back =
        trigger?.isConnected && trigger !== document.body
          ? trigger
          : document.getElementById(MODE_CARD_LINK_ID);
      back?.focus();
    };
  }, [headingId, title]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // React bubbles events from portals (a Radix dialog, anything portalled to <body>) through the
    // component tree. Only keys pressed inside this frame, and not already handled by a layer above
    // it, are the panel's: Escape closes the topmost layer only.
    if (event.defaultPrevented || frame.current === null || !frame.current.contains(event.target as Node))
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...frame.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => isReachable(element));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-slot="mode-overlay-root" className="fixed inset-0 z-50 lg:bg-[rgb(10_13_18/0.74)]">
      {/* The scrim is decoration; Close, Escape and Back are the ways out. */}
      <div
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
        className="fixed inset-0 flex flex-col overflow-hidden bg-card text-foreground lg:inset-x-0 lg:top-8 lg:bottom-auto lg:mx-auto lg:max-h-[calc(100svh-64px)] lg:w-[min(1180px,calc(100vw-64px))] lg:rounded-card lg:border lg:border-border-strong lg:shadow-overlay forced-colors:border-2"
      >
        <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card px-4 lg:px-6">
          <p className="min-w-0 text-[0.9375rem] text-muted-foreground [overflow-wrap:anywhere]">
            {lobbyLabel === null ? (
              <>
                {PANEL_CRUMB_TONIGHT}
                <span aria-hidden="true">{' · '}</span>
              </>
            ) : (
              <>
                {/* Below 1024 the crumb drops `Tonight` so `× Close` keeps its 44 px (14.5). */}
                <span className="hidden lg:inline">
                  {PANEL_CRUMB_TONIGHT}
                  <span aria-hidden="true">{' · '}</span>
                </span>
                {lobbyLabel}
                <span aria-hidden="true">{' · '}</span>
              </>
            )}
            {PANEL_CRUMB_MODE}
          </p>
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border-strong bg-raised px-3 text-sm font-bold"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {PANEL_CLOSE}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] lg:px-6 lg:pt-5 lg:pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Body children the panel never makes inert (05-design.md 8.6 rule 7): Next's route announcer and
 * any live region (Tonight's announcer portals itself to <body> for exactly this), so a Realtime
 * change behind the panel is still spoken.
 */
export function keepsLive(element: HTMLElement): boolean {
  return (
    element.tagName.toLowerCase() === 'next-route-announcer' ||
    element.hasAttribute('aria-live') ||
    element.hasAttribute('data-keep-live')
  );
}

/** A focus-trap stop: not hidden, and not inside a closed `<details>` (its summary still counts). */
function isReachable(element: HTMLElement): boolean {
  if (element.closest('[hidden]') !== null) return false;
  const details = element.closest('details');
  if (details !== null && !details.open && element.tagName.toLowerCase() !== 'summary') return false;
  return true;
}
