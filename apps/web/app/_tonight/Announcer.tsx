'use client';

import { nextRated, type RuleOption } from '@customs/core';
import type { GroupMode } from '@customs/db/schemas';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ModeSlice, useModeSlice } from '@/lib/mode/clientStore';
import { MODE_ANNOUNCEMENTS } from '@/lib/mode/copy';
import { type ModeSpeech, modeSpeechLine } from '@/lib/mode/speech';
import { ANNOUNCE_EVENT } from '@/lib/mode/spinEvents';

/**
 * Tonight's one polite announcer (05-design.md 6.4). It speaks the page's sentence for this
 * snapshot (React replaces the text in place on every server re-render), and once, when the Mode
 * card changes under the page, the card's line instead: M14.30's `Mode: Normal. Every champion is
 * open.`, and since M15.5 the rule lines (`Next game: Class wars, tanks only. Not rated.`, `This
 * game's rule is done. Back to Fearless.`, `Next game is not rated.`) and the Spin reveal's landing
 * (`Spin says: Tanks only.`, from {@link ANNOUNCE_EVENT}). Never on first paint: a live region's
 * initial content is not announced, and the first mode is not a change.
 *
 * M19.13: with `live`, the card's facts come from the client mode store (what a `group_modes` row
 * or a control's answer confirmed, never a tap still in flight), so a mode change with no server
 * render is still said once.
 */
export interface AnnouncerLive {
  groupId: string;
  slice: ModeSlice;
  /** The rule locked on tonight's live lobby (balanced, in game), or null. */
  lockedRule: RuleOption | null;
  /** The card is this game's lock (balanced or in game, with a lock). */
  locked: boolean;
  lobbyStatus: string | null;
  /** The render's `group_modes` read failed: keep the last good state, never announce a stand-in. */
  readFailed?: boolean | undefined;
}

const NO_SLICE: ModeSlice = {
  row: { standing: 'normal', pending: null, rated: null },
  updatedAt: null,
  resetAt: null,
};

export function Announcer({
  text,
  mode: serverMode,
  speech: serverSpeech,
  live,
}: {
  text: string;
  mode: GroupMode;
  /** The card's facts (M15.5); absent, only a standing-mode change is said (M14.30). */
  speech?: ModeSpeech | undefined;
  live?: AnnouncerLive | undefined;
}) {
  const merged = useModeSlice(live?.groupId ?? '', live?.slice ?? NO_SLICE, false, live?.readFailed === true);
  const mode: GroupMode = live === undefined ? serverMode : merged.row.standing;
  const speech: ModeSpeech | undefined =
    live === undefined
      ? serverSpeech
      : {
          standing: merged.row.standing,
          pending: merged.row.pending,
          nextRated: nextRated(merged.row),
          lockedRule: live.lockedRule,
          locked: live.locked,
          lobbyStatus: live.lobbyStatus,
        };
  const lastMode = useRef(mode);
  const lastSpeech = useRef(speech);
  const lastText = useRef(text);
  const [modeLine, setModeLine] = useState<string | null>(null);
  // After hydration the region moves to <body>, outside everything the mode panel makes inert
  // (05-design.md 8.6 rule 7), so Realtime changes are still spoken with the panel open.
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const line = typeof detail === 'object' && detail !== null && 'line' in detail ? detail.line : null;
      if (typeof line === 'string') setModeLine(line);
    };
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
  }, []);

  // Every render: a new sentence clears the mode line, and a card change sets it (checked second,
  // so a render that changes both keeps the mode line).
  useEffect(() => {
    if (text !== lastText.current) {
      lastText.current = text;
      setModeLine(null);
    }
    if (speech !== undefined && lastSpeech.current !== undefined) {
      const line = modeSpeechLine(lastSpeech.current, speech);
      lastSpeech.current = speech;
      lastMode.current = mode;
      if (line !== null) setModeLine(line);
      return;
    }
    lastSpeech.current = speech;
    if (mode !== lastMode.current) {
      lastMode.current = mode;
      setModeLine(MODE_ANNOUNCEMENTS[mode]);
    }
  });

  const region = (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-keep-live="">
      {modeLine ?? text}
    </p>
  );
  return host === null ? region : createPortal(region, host);
}
