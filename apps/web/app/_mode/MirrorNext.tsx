'use client';

import type { ReactNode } from 'react';
import { type ModeSlice, useModeSlice } from '@/lib/mode/clientStore';

/**
 * Shows its children (the mirror host line while a lobby fills, M15.16) only while the next game's
 * rule is mirror match, as the client mode store has it (M19.13): an admin picking mirror, or
 * moving off it, changes the line with the card, with no server render.
 */
export function MirrorNext({
  groupId,
  slice,
  readFailed = false,
  children,
}: {
  groupId: string;
  slice: ModeSlice;
  readFailed?: boolean;
  children: ReactNode;
}) {
  const merged = useModeSlice(groupId, slice, true, readFailed);
  return merged.row.pending?.id === 'mirror' ? children : null;
}
