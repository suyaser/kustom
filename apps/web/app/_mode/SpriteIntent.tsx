'use client';

import { useEffect } from 'react';
import { preload } from 'react-dom';

/** The attribute a link that opens the mode panel carries, so intent on it warms the sheets. */
const WARM_SPRITES_ATTR = 'data-warm-sprites';

/**
 * Preloads the six sprite sheets on **intent** (M14.45, 05-design.md 8.8): the first pointer over
 * (`pointerover`, the bubbling twin of pointerenter, which a tap also fires) or focus on any link
 * marked {@link WARM_SPRITES_ATTR}: the Mode card's row, its lane tiles, the answer band's jump.
 * Not on Tonight's render: the card shows at most ten icons, its own squares, and the panel shows
 * them all. The panel still preloads them itself when it renders, and the links are plain links,
 * so nothing here is needed without JS.
 *
 * One delegated listener pair on the document, removed after the first hit (`preload` dedupes
 * anyway), so the links stay server-rendered `next/link`s. The URLs come from the server
 * (`spriteSheetUrls()`), so Tonight's bundle shares no Data Dragon module with the panel's island.
 * Renders nothing.
 */
export function SpriteIntent({ sheets }: { sheets: readonly string[] }) {
  useEffect(() => {
    const onIntent = (event: Event): void => {
      if (!(event.target instanceof Element) || event.target.closest(`[${WARM_SPRITES_ATTR}]`) === null)
        return;
      for (const href of sheets) preload(href, { as: 'image', fetchPriority: 'low' });
      stop();
    };
    const stop = (): void => {
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('focusin', onIntent);
    };
    document.addEventListener('pointerover', onIntent);
    document.addEventListener('focusin', onIntent);
    return stop;
  }, [sheets]);
  return null;
}
