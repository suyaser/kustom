'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { currentMainTab, mainTabs } from '@/lib/nav';
import { MAIN_NAV_LABEL } from '@/lib/shellCopy';
import { showsLiveDot, useLiveState } from '@/lib/tonight/live';
import { cn } from '@/lib/utils';
import { LinkPendingProbe, useNavPending } from './navPending';
import { TabIcon } from './TabIcon';

/** Inputs that raise the phone keyboard. A checkbox or a button does not. */
const TYPING_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

function raisesKeyboard(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TYPING_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * The bottom tab bar, below 1024px (05-design.md 5.11; five tabs since M14.7b, redesign/nav/proposal.md
 * option A): Tonight · Board · Games · Stats · You, icon over word on every tab, fixed, 60px plus the
 * safe area. Five equal tabs are 75px each at 375.
 *
 * - The current section has `aria-current="page"`, the foreground label, a 3px `--primary-text` bar on
 *   the tab's top edge and a filled icon: weight, an indicator and a shape, not colour alone.
 * - It is the first `<nav aria-label="Main">` in the DOM, before `<main>`. The desktop top bar draws the
 *   same five as a second `Main` nav, and CSS shows exactly one of the two at any width, so the
 *   accessibility tree only ever has one.
 * - A tap answers on the tab in the same paint (M19.15, 5.9a): `useLinkStatus` through
 *   `LinkPendingProbe`, `data-pending` on the link, a neutral bar beside the current amber one.
 * - While a text field has focus it hides: the keyboard covers it anyway, and on iOS it would jump
 *   above the keyboard.
 *
 * A client component for the current tab (`usePathname`) and the keyboard rule; it is server-rendered
 * first, so it is in the first paint with no JavaScript.
 */
export function TabBar({ group }: { group: PageGroup }) {
  const pathname = usePathname();
  const tabs = mainTabs(group);
  const current = currentMainTab(pathname, group);
  const [typing, setTyping] = useState(false);
  // M14.9 (05-design.md 5.11, STRATEGY 2.5): an 8px amber dot on Tonight while a lobby is live and
  // the tonight page's channel is subscribed. Decoration: the page says `Live` in words.
  const liveDot = showsLiveDot(useLiveState());
  const { pendingTab } = useNavPending();

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => setTyping(raisesKeyboard(event.target));
    const onFocusOut = () => setTyping(false);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return (
    <nav
      aria-label={MAIN_NAV_LABEL}
      data-typing={typing ? '' : undefined}
      className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-[minmax(0,1fr)] grid-flow-col border-t border-border-strong bg-card pb-[env(safe-area-inset-bottom)] data-typing:hidden lg:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.key === current;
        // M19.15 (5.9a): the tab a tap is waiting on looks active (foreground, filled icon) with a
        // neutral `--border-strong` bar; the tab still on screen keeps `aria-current` and its amber bar.
        const pending = !active && pendingTab === tab.key;
        return (
          <Link
            prefetch="auto"
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            data-pending={pending ? '' : undefined}
            className={cn(
              'relative flex min-h-(--tabbar-h) flex-col items-center justify-center gap-1 text-2xs font-bold text-muted-foreground',
              'transition-[color,scale] duration-(--dur-fast) ease-out active:scale-[.98] active:duration-(--dur-press)',
              'focus-visible:-outline-offset-4',
              (active || pending) &&
                'text-foreground before:absolute before:inset-x-[26%] before:-top-px before:h-[3px] before:rounded-b-[3px]',
              active && 'before:bg-primary-text',
              pending && 'before:bg-border-strong',
            )}
          >
            <LinkPendingProbe tab={tab.key} current={active} />
            <span className="relative">
              <TabIcon tab={tab.key} active={active || pending} />
              {tab.key === 'tonight' && liveDot ? (
                <span
                  aria-hidden="true"
                  data-slot="live-dot"
                  className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary-fill"
                />
              ) : null}
            </span>
            {/* M14.42: at 200% text a label wraps or hyphenates inside its fifth, never widens the bar. */}
            <span className="max-w-full text-center leading-tight hyphens-auto [overflow-wrap:anywhere]">
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
