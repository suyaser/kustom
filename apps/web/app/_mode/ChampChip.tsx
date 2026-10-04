import { championSpriteStyle } from '@/lib/champs/ddragon';
import { championSquare } from '@/lib/champs/square';
import { cn } from '@/lib/utils';

/**
 * Champion chips (05-design.md 8.7.3): a 24px square icon from Data Dragon's sprite sheets (8.8)
 * and the name, which is the accessible text. Server-safe (no hooks), so the Mode card's
 * `Banned next game` renders on the server and the panel's client island reuses the same parts.
 *
 * The icon exception: 24 × 24, radius 4, never a circle, `aria-hidden`, never without its name. An
 * id the pinned sprites do not ship draws **no box at all**. A sheet that fails to load is the
 * panel's to handle (`data-icons="off"` on an ancestor hides every icon, one reflow).
 */
export function ChampIcon({ id, muted = false }: { id: number; muted?: boolean }) {
  const sprite = championSpriteStyle(id);
  if (sprite === null) return null;
  return (
    <i
      aria-hidden="true"
      data-slot="champ-icon"
      className={cn(
        'block size-6 shrink-0 rounded-chip bg-no-repeat in-data-[icons=off]:hidden',
        muted && 'opacity-55',
      )}
      style={{
        backgroundImage: `url(${sprite.sheetUrl})`,
        backgroundSize: sprite.backgroundSize,
        backgroundPosition: sprite.backgroundPosition,
      }}
    />
  );
}

/**
 * One champion's own square (M14.45, 05-design.md 8.8), for the Mode card on Tonight, which shows
 * at most ten icons: downloading the six sheets (826 KB) for those was most of Tonight's weight.
 * Lazy, with an explicit 24 × 24, through Next's image optimizer (`championSquare`), from the
 * pinned version's square (the same pin as the sheets). A plain server-rendered `<img>`: no client
 * code, works without JS. An id the pin does not ship draws nothing.
 */
export function ChampSquare({ id }: { id: number }) {
  const square = championSquare(id);
  if (square === null) return null;
  return (
    // biome-ignore lint/performance/noImgElement: next/image would ship its client component to Tonight for ten static squares
    <img
      src={square.src}
      srcSet={square.srcSet}
      width={square.size}
      height={square.size}
      loading="lazy"
      decoding="async"
      alt=""
      aria-hidden="true"
      data-slot="champ-icon"
      className="block size-6 shrink-0 rounded-chip in-data-[icons=off]:hidden"
    />
  );
}

/**
 * Open (primary): a grid cell, `--raised`, name text 600 17. A find hit is inverted. `square`
 * (the Mode card, M14.45) draws the champion's own square instead of a sprite cell.
 */
export function OpenChip({
  id,
  name,
  hit = false,
  square = false,
}: {
  id: number;
  name: string;
  hit?: boolean;
  square?: boolean;
}) {
  return (
    <li
      data-hit={hit ? '' : undefined}
      className={cn(
        'flex min-h-10 items-center gap-[7px] rounded-chip border border-border bg-raised py-1 pr-1.5 pl-[5px]',
        'text-base font-semibold [overflow-wrap:break-word]',
        hit && 'border-foreground bg-foreground text-card',
      )}
    >
      {square ? <ChampSquare id={id} /> : <ChampIcon id={id} />}
      <span className="min-w-0">{name}</span>
    </li>
  );
}

/** Banned (secondary): natural width, transparent, solid border, muted name, icon at 55%. */
export function BannedChip({ id, name, hit = false }: { id: number; name: string; hit?: boolean }) {
  return (
    <li
      data-hit={hit ? '' : undefined}
      className={cn(
        'inline-flex min-h-[34px] items-center gap-1.5 rounded-chip border border-border px-1.5 text-xs text-muted-foreground',
        hit && 'border-foreground bg-foreground text-card',
      )}
    >
      <ChampIcon id={id} muted={!hit} />
      <span>{name}</span>
    </li>
  );
}
