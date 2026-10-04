import type { StaticImageData } from 'next/image';
import { RatingDelta } from '@/app/_board/RatingDelta';
import { RoleIcon } from '@/app/_icons/RoleIcon';
import { oddsOf } from '@/components/receipt/model';
import { WinBar } from '@/components/receipt/win-bar';
import { SideGlyph } from '@/components/ui/side-glyph';
import { formatMinutes } from '@/lib/games/duration';
import {
  EXAMPLE_GAME_CAPTION,
  EXAMPLE_GAME_HEADERS,
  EXAMPLE_GAME_TABLE_CAPTION,
  EXAMPLE_GAME_WON,
} from '@/lib/landing/copy';
import { EXAMPLE_GAME, type ExampleSeat } from '@/lib/landing/exampleGame';
import { cn } from '@/lib/utils';
import ahri from './champions/Ahri.webp';
import amumu from './champions/Amumu.webp';
import darius from './champions/Darius.webp';
import ezreal from './champions/Ezreal.webp';
import garen from './champions/Garen.webp';
import jinx from './champions/Jinx.webp';
import leeSin from './champions/LeeSin.webp';
import lux from './champions/Lux.webp';
import thresh from './champions/Thresh.webp';
import yasuo from './champions/Yasuo.webp';

/**
 * The landing hero's picture (docs/05-design.md section 12): one finished example game, the compact
 * win bar and then the five lanes, blue on the left and red mirrored on the right, each seat with its
 * champion square, name and rating change. The second named exception to 1.1 rule 6, and the only
 * place it applies: nothing else on the page, and nothing in Tonight, draws a champion.
 *
 * A fixture (`lib/landing/exampleGame.ts`), captioned as one. Server-rendered, no JavaScript.
 *
 * The squares are committed WebP files (`pnpm --filter web landing-champs`), statically imported so
 * Next serves them from `/_next/static/media/` with immutable caching: no Data Dragon request, no
 * image optimizer (12.7). Plain `<img>` with `width`/`height` and a px CSS size (they never scale
 * with text, 12.6), so the box is reserved before the bytes arrive (CLS 0); `fetchpriority="low"` so
 * the fonts and the h1 win.
 *
 * The rows are a real table (12.6): a visually hidden caption and column headers, and the lane as
 * the row header. In each side's cell the name comes before the square in the DOM, so a row reads
 * ‹top · Hana, Garen, lost 18 · Omar, Darius, gained 17›.
 *
 * Large text (12.3a): the card is an inline-size container, and below 18em (its own font size, so
 * the switch follows the text size, not the screen) each row stacks: the lane on its own line, then
 * the two seats side by side, each square over name over change. The table parts carry explicit
 * ARIA roles in every mode, because a `display` change on table parts can drop their semantics.
 * Every `@max-[18em]:` class below is that one mode; Tailwind needs them written out in full.
 */

/** Data Dragon id to its committed file; `exampleGame.test.ts` holds this beside the fixture. */
const SQUARES: Readonly<Record<string, StaticImageData | string>> = {
  Ahri: ahri,
  Amumu: amumu,
  Darius: darius,
  Ezreal: ezreal,
  Garen: garen,
  Jinx: jinx,
  LeeSin: leeSin,
  Lux: lux,
  Thresh: thresh,
  Yasuo: yasuo,
};

/** Next types a static import as `StaticImageData`; the test runner's bundler hands back the URL. */
function srcOf(image: StaticImageData | string | undefined): string | undefined {
  if (image === undefined) return undefined;
  return typeof image === 'string' ? image : image.src;
}

/** The phone size; CSS draws 40 / 48 / 56 (12.3). */
const SQUARE_ATTR = 40;

export function ExampleGame() {
  const game = EXAMPLE_GAME;
  const odds = oddsOf(game.blueWinProb);
  const winner = game.winner === 200 ? 'red' : 'blue';
  return (
    <figure className="flex w-full max-w-[30rem] flex-col gap-2">
      <div className="@container rounded-card border border-border bg-card p-(--card-pad)">
        <p className="flex items-center gap-2">
          <SideGlyph
            side={winner}
            className={cn('size-[13px]', winner === 'red' ? 'text-team-red' : 'text-team-blue')}
          />
          <span className="flex-1 text-md font-bold text-foreground">{EXAMPLE_GAME_WON}</span>
          <span className="num text-xs text-muted-foreground">{formatMinutes(game.durationS)}</span>
        </p>
        {odds === null ? null : (
          <div className="mt-2 mb-3">
            <WinBar odds={odds} size="compact" />
          </div>
        )}
        {/* biome-ignore lint/a11y/noRedundantRoles: 12.3a, the roles survive the stacked mode's display change */}
        <table role="table" className="w-full table-fixed border-collapse">
          <caption className="sr-only">{EXAMPLE_GAME_TABLE_CAPTION}</caption>
          <colgroup>
            <col />
            <col className="w-14" />
            <col />
          </colgroup>
          <thead>
            {/* biome-ignore lint/a11y/noRedundantRoles: 12.3a */}
            <tr role="row">
              {/* biome-ignore lint/a11y/noRedundantRoles: 12.3a */}
              <th scope="col" role="columnheader" className="sr-only">
                {EXAMPLE_GAME_HEADERS.blue}
              </th>
              {/* biome-ignore lint/a11y/noRedundantRoles: 12.3a */}
              <th scope="col" role="columnheader" className="sr-only">
                {EXAMPLE_GAME_HEADERS.lane}
              </th>
              {/* biome-ignore lint/a11y/noRedundantRoles: 12.3a */}
              <th scope="col" role="columnheader" className="sr-only">
                {EXAMPLE_GAME_HEADERS.red}
              </th>
            </tr>
          </thead>
          <tbody>
            {game.lanes.map((lane) => (
              <tr
                key={lane.role}
                // biome-ignore lint/a11y/noRedundantRoles: 12.3a
                role="row"
                className="border-t border-border @max-[18em]:grid @max-[18em]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @max-[18em]:gap-x-[8px] @max-[18em]:py-2"
              >
                <td
                  // biome-ignore lint/a11y/noRedundantRoles: 12.3a
                  role="cell"
                  className="py-2 pe-[8px] lg:pe-[12px] @max-[18em]:p-0 @max-[18em]:[grid-area:2/1]"
                >
                  <Seat seat={lane.blue} side="blue" />
                </td>
                <th
                  scope="row"
                  // biome-ignore lint/a11y/noRedundantRoles: 12.3a
                  role="rowheader"
                  className="py-2 font-normal @max-[18em]:p-0 @max-[18em]:pb-1 @max-[18em]:[grid-column:1/-1] @max-[18em]:[grid-row:1]"
                >
                  <span className="flex flex-col items-center gap-0.5 text-muted-foreground @max-[18em]:flex-row @max-[18em]:justify-center @max-[18em]:gap-[4px]">
                    <RoleIcon role={lane.role} size={20} />
                    <span className="font-mono text-2xs font-stretch-75%">{lane.role}</span>
                  </span>
                </th>
                <td
                  // biome-ignore lint/a11y/noRedundantRoles: 12.3a
                  role="cell"
                  className="py-2 ps-[8px] lg:ps-[12px] @max-[18em]:p-0 @max-[18em]:[grid-area:2/2]"
                >
                  <Seat seat={lane.red} side="red" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="text-sm text-muted-foreground">{EXAMPLE_GAME_CAPTION}</figcaption>
    </figure>
  );
}

/**
 * Name, square, change in the DOM, so a screen reader hears ‹Hana, Garen, lost 18› (12.6). A 2 x 2
 * grid draws the square at the outer edge spanning both lines, with the name over the change beside
 * it. Red mirrors blue. Stacked (12.3a): one column, square over name over change, blue
 * start-aligned and red end-aligned.
 */
function Seat({ seat, side }: { seat: ExampleSeat; side: 'blue' | 'red' }) {
  const blue = side === 'blue';
  return (
    <span
      className={cn(
        'grid items-center gap-x-[8px] gap-y-0.5 lg:gap-x-[12px] @max-[18em]:grid-cols-1',
        blue ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_auto]',
      )}
    >
      <span
        className={cn(
          'row-start-1 self-end text-sm font-bold text-foreground [overflow-wrap:anywhere] lg:text-md @max-[18em]:self-start @max-[18em]:[grid-area:2/1]',
          blue ? 'col-start-2 text-start' : 'col-start-1 text-end',
        )}
      >
        {seat.name}
      </span>
      {/* biome-ignore lint/performance/noImgElement: 05-design 12.7 bans the optimizer here; the committed 128px WebP is served as is */}
      <img
        src={srcOf(SQUARES[seat.ddragonId])}
        alt={seat.championName}
        width={SQUARE_ATTR}
        height={SQUARE_ATTR}
        loading="eager"
        decoding="async"
        fetchPriority="low"
        className={cn(
          'row-span-2 row-start-1 block size-[40px] overflow-hidden rounded-chip bg-raised object-cover md:size-[48px] lg:size-[56px] @max-[18em]:mb-1 @max-[18em]:size-[40px] @max-[18em]:[grid-area:1/1]',
          blue ? 'col-start-1 @max-[18em]:justify-self-start' : 'col-start-2 @max-[18em]:justify-self-end',
        )}
      />
      <span
        className={cn(
          'row-start-2 self-start @max-[18em]:[grid-area:3/1]',
          blue ? 'col-start-2 justify-self-start' : 'col-start-1 justify-self-end',
        )}
      >
        <RatingDelta delta={seat.change} width="change" className="text-xs" />
      </span>
    </span>
  );
}
