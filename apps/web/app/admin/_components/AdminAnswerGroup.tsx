'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * The place a write's answer is shown when the control that made it **does not survive the
 * write** (M3.20, reviewer 2026-09-09).
 *
 * Two controls on `/admin` remove themselves by succeeding: `Revoke` becomes the word `revoked`
 * on the next render, and `Promote split 2` disappears once split 2 is the chosen one. Their
 * sentence used to live inside the `<form>`, so `router.refresh()` unmounted it a moment after
 * it appeared — and for the reroll that sentence is the only place the page says whether
 * Discord took the post. Focus went with it, to `<body>`.
 *
 * So the answer is lifted here: the group is rendered **unconditionally** by the row or the
 * block around those controls, it survives the re-render that swaps them out, and it prints the
 * sentence after its children. A form inside a group hands its answer up instead of drawing it
 * itself; a form with no group above it draws it inline, which is right for every control that
 * is still there afterwards.
 *
 * Focus: only moved when the press cost us the focused element. If the button is still on
 * screen it keeps the focus, which is what M3.20 asks for; if it was removed, the browser drops
 * focus to `<body>` and the sentence takes it instead, so a keyboard reader is on the answer to
 * the thing they just pressed rather than at the top of the document.
 */

export interface GroupAnswer {
  ok: boolean;
  text: string;
  /** The freshly minted companion token, which exists in that one response and nowhere else. */
  token: string | null;
}

/**
 * `null` on the way **in** clears the sentence — a form does that at the top of every submit,
 * so pressing a refused control twice removes the old answer and announces the new one instead
 * of leaving the same node on screen saying the same thing.
 */
type AnswerSink = (answer: GroupAnswer | null) => void;

const AnswerContext = createContext<AnswerSink | null>(null);

/** Used by `AdminForm`: `null` means "no group above me, draw the sentence yourself". */
export function useAnswerSink(): AnswerSink | null {
  return useContext(AnswerContext);
}

export function AdminAnswerGroup({ children, className }: { children: ReactNode; className?: string }) {
  const [answer, setAnswer] = useState<GroupAnswer | null>(null);
  const sentence = useRef<HTMLParagraphElement | null>(null);
  /** Whatever had the focus when the answer arrived — the control that was pressed. */
  const pressed = useRef<Element | null>(null);
  const report = useCallback((next: GroupAnswer | null) => {
    // A press starts by clearing: nothing to point at, and nothing to move the focus for.
    pressed.current = next === null ? null : document.activeElement;
    setAnswer(next);
  }, []);

  // Deliberately on **every** render, not only when the answer changes: the re-read that takes
  // the control away lands one render later, and that is the render where the focus is lost.
  useEffect(() => {
    const control = pressed.current;
    if (answer === null || control === null) return;
    // Still on screen: it keeps the focus, which is what M3.20 asks for.
    if (control.isConnected) return;

    const active = document.activeElement;
    if (active === null || active === document.body) sentence.current?.focus();
    pressed.current = null;
  });

  return (
    <AnswerContext.Provider value={report}>
      <div className={className}>
        {children}
        {answer === null ? null : (
          <p
            ref={sentence}
            tabIndex={-1}
            className={answer.ok ? 'admin-notice' : 'admin-error'}
            role={answer.ok ? 'status' : 'alert'}
          >
            {answer.text}
          </p>
        )}
        {answer?.token == null ? null : <MintedToken token={answer.token} />}
      </div>
    </AnswerContext.Provider>
  );
}

/**
 * Product's words for the friend who has to paste it, from the one-time page (M1.9). It is
 * shown here because with JavaScript on there is no one-time page: that response is the only
 * place the token exists.
 */
export function MintedToken({ token }: { token: string }) {
  return (
    <span className="admin-mono admin-token">
      <strong>Copy it now.</strong> This is the only time it is shown — we only keep a scrambled copy, so we
      cannot show it to you again. Lost it? Mint another and revoke this one. {token}
    </span>
  );
}
