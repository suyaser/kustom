'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { Chip } from '@/components/ui/chip';
import { ANNOUNCE_EVENT } from '@/lib/mode/spinEvents';
import { YOU_TAG } from '@/lib/tonight/screenCopy';
import {
  chipStatusText,
  LOBBIES_NAV,
  type LobbyChip,
  switcherAnnouncement,
  YOU_IN_THIS_LOBBY,
} from '@/lib/tonight/switcher';
import { cn } from '@/lib/utils';

/**
 * The lobby switcher (05-design.md 14.4, M22.6): one chip per live table, a strip row between the
 * top line and the h1. Each chip is a link to `?lobby=<id>`; with JS the tap is a shallow `replace`
 * (no history entry, scroll kept) and the chip paints selected in the frame of the tap, before the
 * server render of that lobby lands. Without JS it is an ordinary link.
 *
 * Drawn by the page on any night two tables overlapped, so it stays mounted while the count goes
 * from two to one and can say `Ana's lobby has ended.` once; **with fewer than two chips it renders
 * nothing at all** (M22 D2). The announcer's lines go through the page's one polite region
 * (`ANNOUNCE_EVENT`, `Announcer`), queued after the render's own sentence so they are not cleared.
 */
export function LobbySwitcher({
  chips,
  selected,
  home,
  renderedAt,
  stalePin = false,
}: {
  chips: readonly LobbyChip[];
  selected: string | null;
  /** `/g/<slug>`: the chip's link adds `?lobby=`. */
  home: string;
  /** The server's clock at render: the in-game minutes' first paint matches the server's. */
  renderedAt: number;
  /** The URL's `?lobby=` names no live table (a pinned table ended): drop it from the URL. */
  stalePin?: boolean;
}) {
  const [tapped, setTapped] = useState<string | null>(null);
  const [now, setNow] = useState(renderedAt);
  const last = useRef({ chips, selected, tapped: false });
  const shown = tapped ?? selected;

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // A render that moved the selection lands the tap; the announcer says what changed, once.
  useEffect(() => {
    const before = last.current;
    const line = switcherAnnouncement(before, { chips, selected }, before.tapped);
    last.current = { chips, selected, tapped: before.tapped && selected === before.selected };
    if (selected !== before.selected) setTapped(null);
    if (line === null) return;
    const timer = setTimeout(() =>
      window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: { line } })),
    );
    return () => clearTimeout(timer);
  }, [chips, selected]);

  useEffect(() => {
    if (stalePin) window.history.replaceState(window.history.state, '', home);
  }, [stalePin, home]);

  if (chips.length < 2) return null;

  function tap(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (id === shown) return;
    last.current = { ...last.current, tapped: true };
    setTapped(id);
  }

  return (
    <nav aria-label={LOBBIES_NAV} data-slot="lobby-switcher" className="mt-2 mb-1">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(max(9rem,calc(50%-0.25rem)),1fr))] gap-2 md:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {chips.map((chip) => {
          const current = chip.id === shown;
          return (
            <li key={chip.key} className="min-w-0">
              <Link
                href={`${home}?lobby=${chip.id}` as Route}
                replace
                prefetch={!current}
                scroll={false}
                onClick={(event) => tap(event, chip.id)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-full min-h-16 flex-col gap-0.5 rounded-control border border-border-strong bg-card px-3 py-2.5 text-foreground',
                  'touch-manipulation transition-colors duration-(--dur-fast) ease-out hover:bg-accent active:scale-[.98] active:duration-(--dur-press)',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  chip.status.kind === 'no-kustom' && 'border-dashed',
                  current &&
                    'border-foreground bg-raised shadow-[inset_0_0_0_1px_var(--foreground),inset_0_-3px_0_var(--primary-text)] hover:bg-raised',
                )}
              >
                {/* The sticker sits on the label's first line; a name too long to share it pushes the
                    sticker to its own line instead of breaking the name mid-word (14.4: wraps between words). */}
                <span className="flex flex-wrap items-start justify-between gap-x-2 md:grid md:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="min-w-0 text-md leading-snug font-bold [overflow-wrap:break-word]">
                    <LabelText label={chip.label} />
                  </span>
                  {chip.you ? (
                    <Chip variant="you" aria-hidden="true" className="mt-0.5 ml-auto">
                      {YOU_TAG}
                    </Chip>
                  ) : null}
                </span>
                {/* Below 768 the mode takes its own line with no dot; from 768 status and mode share one. */}
                <span className="flex flex-col text-xs md:flex-row md:flex-wrap md:gap-x-1">
                  <span className="flex flex-wrap gap-x-1 font-bold tabular-nums">
                    <span className="sr-only">, </span>
                    {chipStatusText(chip.status, now)
                      .split(' · ')
                      .map((part, index) => (
                        <span key={part} className="whitespace-nowrap">
                          {index === 0 ? part : `· ${part}`}
                        </span>
                      ))}
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    <span aria-hidden="true" className="hidden md:inline">
                      ·{' '}
                    </span>
                    <span className="sr-only">, </span>
                    {chip.mode}
                  </span>
                </span>
                {chip.you ? <span className="sr-only">{YOU_IN_THIS_LOBBY}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A break chance before `'s lobby`, so a long name wraps there and not after its apostrophe (14.4). */
function LabelText({ label }: { label: string }) {
  const at = label.lastIndexOf("'s lobby");
  if (at <= 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <wbr />
      {label.slice(at)}
    </>
  );
}
