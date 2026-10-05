import { Fragment } from 'react';
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
        'block size-[24px] shrink-0 rounded-chip bg-no-repeat in-data-[icons=off]:hidden',
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
  regions,
}: {
  id: number;
  name: string;
  hit?: boolean;
  square?: boolean;
  /** M20.5: the champion's region words (`championRegionNames`), Universe first; none, no tag. */
  regions?: readonly string[] | undefined;
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
      <ChipText name={name} regions={regions} hit={hit} />
    </li>
  );
}

/** Banned (secondary): natural width, transparent, solid border, muted name, icon at 55%. */
export function BannedChip({
  id,
  name,
  hit = false,
  regions,
}: {
  id: number;
  name: string;
  hit?: boolean;
  regions?: readonly string[] | undefined;
}) {
  return (
    <li
      data-hit={hit ? '' : undefined}
      className={cn(
        'inline-flex min-h-[34px] items-center gap-1.5 rounded-chip border border-border px-1.5 py-1 text-xs text-muted-foreground',
        hit && 'border-foreground bg-foreground text-card',
      )}
    >
      <ChampIcon id={id} muted={!hit} />
      <ChipText name={name} regions={regions} hit={hit} />
    </li>
  );
}

/** U+00A0: the dot stays on the line of the region before it. */
const NBSP = ' ';

/**
 * The chip's text side (05-design.md 8.15): the name, then the region tag on its own line (text 400
 * 13, line-height 16, muted; `--card` on a find hit, never an opacity). Read as `Vi, Piltover and
 * Zaun`: an sr-only `, ` before the tag, and between two regions the visible ` · ` is aria-hidden
 * beside an sr-only ` and `. No regions: the name alone, no empty element.
 *
 * Wrapping (M20.14: a tag only wraps between words, never inside one): each region is its own
 * `inline-block` unit, the dot at the end of the unit before it (after a no-break space). A tag
 * that does not fit breaks first between the units (`Piltover ·` / `Bandle City`); only a unit
 * wider than the whole line (`Shadow Isles ·` in the card's narrow cell at 375) wraps inside it,
 * and then only at its own space (`Shadow` / `Isles ·`). M20.5's no-break spaces inside region
 * names made `Shadow Isles` one word, which `overflow-wrap: break-word` split as `Shadow Isle` / `s`.
 */
function ChipText({
  name,
  regions,
  hit,
}: {
  name: string;
  regions: readonly string[] | undefined;
  hit: boolean;
}) {
  if (regions === undefined || regions.length === 0) return <span className="min-w-0">{name}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="leading-5">{name}</span>
      <span className="sr-only">, </span>
      <span
        data-slot="region-tag"
        className={cn('text-2xs leading-4 font-normal', hit ? 'text-card' : 'text-muted-foreground')}
      >
        {regions.map((region, index) => (
          <Fragment key={region}>
            {index === 0 ? null : ' '}
            <span data-slot="region-unit" className="inline-block max-w-full">
              {region}
              {index === regions.length - 1 ? null : (
                <>
                  <span aria-hidden="true">{`${NBSP}·`}</span>
                  <span className="sr-only"> and </span>
                </>
              )}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
