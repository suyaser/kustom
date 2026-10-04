'use client';

import { createContext, type ReactNode, useContext, useId, useState } from 'react';
import { WHY_SR } from '@/lib/breakdown/copy';
import { cn } from '@/lib/utils';

/**
 * Tap a rating change to see why it was that size (M14.58).
 *
 * Three pieces, so the number and its explanation can live in different cells of the row's grid
 * (the change sits in the number column; the explanation opens as a full row under the seat):
 *
 * - `WhyScope` holds the open state and renders no element of its own;
 * - `WhyButton` is the change itself as a `button` with `aria-expanded` / `aria-controls`, 44px,
 *   a chevron that turns when open (05-design 5.14's disclosure, no rotation under reduced motion);
 * - `WhyPanel` is the explanation, `hidden` until opened, its words server-rendered as children.
 *
 * Not a native `<details>`: a summary and its content cannot sit in different grid cells, and here
 * they must. Keyboard and screen reader get the same disclosure pattern (Enter/Space toggles,
 * the state is announced). Nothing is hover-only.
 *
 * Client-safe on purpose: React and `cn` only, no zod, no `node:*` (`lib/clientGraph.test.ts`).
 */
interface WhyState {
  open: boolean;
  toggle: () => void;
  panelId: string;
}

const WhyContext = createContext<WhyState | null>(null);

function useWhy(component: string): WhyState {
  const state = useContext(WhyContext);
  if (state === null) throw new Error(`${component} must be inside a WhyScope`);
  return state;
}

export function WhyScope({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <WhyContext.Provider value={{ open, toggle: () => setOpen((value) => !value), panelId }}>
      {children}
    </WhyContext.Provider>
  );
}

/**
 * The change as the disclosure's button. `children` is the visible change with its own screen-reader
 * words (`<Delta>` / `<RatingDelta>`); the button adds `. Why?` after them, so it is read as
 * ‹lost 50. Why?, collapsed›.
 */
export function WhyButton({ children, className }: { children: ReactNode; className?: string | undefined }) {
  const { open, toggle, panelId } = useWhy('WhyButton');
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={toggle}
      data-slot="why-button"
      className={cn(
        'group/why relative z-10 inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-end gap-1 rounded-control',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      {children}
      <span className="sr-only">{WHY_SR}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        aria-hidden="true"
        className="shrink-0 text-muted-foreground transition-transform duration-(--dur-base) group-aria-expanded/why:rotate-180 motion-reduce:transition-none"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

/** The explanation, under the row; `hidden` (out of the layout and the accessibility tree) while closed. */
export function WhyPanel({ children, className }: { children: ReactNode; className?: string | undefined }) {
  const { open, panelId } = useWhy('WhyPanel');
  return (
    <div
      id={panelId}
      hidden={!open}
      data-slot="why-panel"
      className={cn(
        'relative z-10 flex flex-col gap-1.5 rounded-control border border-border bg-background px-3 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
