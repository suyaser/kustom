import { displayRating } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type { BoardRow } from '@/lib/board/types';
import { favoredClause, formatDamage, formatDuration } from '@/lib/discord/embeds';
import type { MysteryPageState } from '@/lib/mystery/service';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from '@/lib/season';
import {
  HEAD_SEPARATOR,
  joinWebNames,
  MISSED_INVITE_END,
  MISSED_INVITE_LEAD,
  MISSED_INVITE_PASSWORD,
  NAMELESS_HINT,
  OFF_ROLE_LEGEND,
  OFF_ROLE_LEGEND_SUFFIX,
  renderWebName,
  SIT_OUT_VIEWER,
  sitOutGeneral,
} from '@/lib/tonight/copy';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import { anySeatOnTheWrongSide, hasNamelessRow, tonightHeader, tonightState } from '@/lib/tonight/state';
import type {
  LobbyView,
  MemberView,
  ResultSeatView,
  ResultView,
  SeatView,
  TeamsView,
  TonightSnapshot,
} from '@/lib/tonight/types';
import { type ViewerState, viewerIsAdmin, viewerPuuid } from '@/lib/tonight/viewer';
import { RoleIcon } from '../_icons/RoleIcon';
import { TopOfBoard } from '../_leaderboard/BoardCard';
import { MysteryLive } from '../_mystery/MysteryLive';
import { CompanionCard, HowThisWorksCard } from '../_shell/HowThisWorks';
import { RerollControl } from './RerollControl';
import { RoleTonight } from './RoleTonight';
import { SeatRack } from './SeatRack';
import { SideLine } from './SideLine';
import { StartLobby, StartLobbySignIn } from './StartLobby';

/**
 * The tonight page's markup (M3.4, Floodlit v2 in M3.18). A pure function of one snapshot and
 * who is looking, so every state in `05-design.md`'s table is a component test rather than a
 * night of waiting.
 *
 * The two rules this file exists to keep, neither of which v2 bends:
 *
 *   - **One primary block**, chosen from `lobbies.status`, replaced in place. The status strip
 *     is always mounted and is the only element that survives every transition.
 *   - **No layout shift inside a state.** A join, a leave, a name arriving and a reroll each
 *     move nothing above the fold: the rack is ten rows at every count, the strip's sentence
 *     has two lines reserved, and both markers are inset shadows rather than borders.
 *
 * The rail is the ≥1080px second column. It never carries state — three static cards — and it
 * is `display: none` below that, where the same two cards are in the footer.
 */

/**
 * Marked seats in **one** card at which the off-role icon and word go back to `dim`
 * (`05-design.md`, "The amber threshold"). Three of five is the majority; the mark keeps its
 * shape — underline, dot, hidden word, header legend — and gives up only its colour.
 */
const OFF_ROLE_COLOUR_LIMIT = 3;

export interface TonightViewProps {
  snapshot: TonightSnapshot;
  /**
   * Who is reading, in three states (`lib/tonight/viewer.ts`): anonymous, signed in with no
   * player row yet, or linked. Decided on the server from the session, and never a claim the
   * browser makes — every control it draws posts to a route that checks the session again.
   */
  viewer: ViewerState;
  /**
   * The board's first five, for the ≥1080px rail (`loadTopPlayers(client, { limit: 5 })`).
   * Read once with the page: **the rail never carries state**, so these do not move under a
   * thumb the way everything in the column beside them does. Empty until a season exists.
   */
  topPlayers: readonly BoardRow[];
  /**
   * Tonight's newest `create_lobby`, read on the **server** with the service role and only for
   * a linked viewer (`lib/tonight/lobbyStart.ts`). `null` for everybody else and for a night nobody
   * has pressed the button on. It is not part of the snapshot on purpose: the snapshot is
   * re-read in the browser with the anon key, which may not see this table at all.
   */
  lobbyStart?: LobbyStartView | null;
  /**
   * Re-read this page's server components. `TonightLive` supplies it; it is how the self-link
   * (M3.6) turns into a linked viewer — and a footer with `Your games` in it — without a
   * document load. Undefined everywhere the page is rendered without a router.
   */
  onViewerChanged?: (() => void) | undefined;
  /**
   * The same re-read, asked for by the press instead of by a self-link: `companion_commands`
   * is service-role only and in no Realtime publication, so the only way to learn what became
   * of a `create_lobby` is to ask the server again. Two props and one function, because the
   * two things they re-read are two different facts that happen to live in one place.
   */
  onLobbyStarted?: (() => void) | undefined;
  /**
   * Today's Daily Mystery (M5.32). Optional so the tonight fixture tests stay a
   * snapshot of the lobby. The live page always passes one.
   */
  mystery?: MysteryPageState | null;
}

export function TonightView({
  snapshot,
  viewer,
  topPlayers,
  lobbyStart = null,
  onViewerChanged,
  onLobbyStarted,
  mystery = null,
}: TonightViewProps) {
  const state = tonightState(snapshot);
  const header = tonightHeader(state);
  const seatViewer = { puuid: viewerPuuid(viewer), isAdmin: viewerIsAdmin(viewer) };
  /**
   * M4.10's lobby line is for a **signed-in viewer matched to a player row** and nobody else
   * (product and the designer, 2026-09-10). The password is not a secret among the twenty
   * friends who play; it is not for whoever the WhatsApp link was forwarded to.
   *
   * It is the `Start a lobby` gate too, since M4.13: the same twenty people, decided once.
   */
  const linked = viewer.kind === 'linked';
  /**
   * `Start a lobby` (M4.2), with the button in the one state where pressing it can do
   * anything: the idle page (the designer, 2026-09-10). From `filling` on a lobby row exists,
   * so the route can only answer `There is already a lobby open.` — and a control whose only
   * outcome is a refusal is not a control. `filling` gets the same block without the button:
   * the invited count, or the sentence for a create that failed.
   *
   * **Every linked player, not only an admin** (M4.13): nobody in voice should have to find out
   * who is an admin to get the night started. `players.is_admin` can only be true on a row that
   * is already linked, so an admin keeps it with no special case. Being drawn is still not
   * permission — the route resolves the session again before it writes, and a forged press gets
   * the 403 sentence.
   */
  const startLobby = linked ? (
    <StartLobby
      start={lobbyStart}
      press={state.kind === 'idle'}
      around={state.kind === 'filling' ? state.lobby.members.length : 0}
      onPressed={onLobbyStarted}
    />
  ) : null;
  /**
   * And the signed-out visitor's way in, on the **idle** page only: the sentence product wrote
   * for M4.2 and suspended on 2026-09-10, back now that there is a button behind it for anybody
   * who signs in (M4.13). A signed-in visitor with **no player row** gets neither — they are
   * signed in, so inviting them to sign in is noise, and `SIGNED_IN_NO_LOBBY` at the foot of
   * the column already says the true thing to them.
   */
  const startSignIn = viewer.kind === 'anonymous' && state.kind === 'idle' ? <StartLobbySignIn /> : null;

  /**
   * **The idle page keeps the 44rem column it has at 720px** (M3.30, the designer, from the
   * M4.7 review). At 1080px the grid hands the main column everything the 20rem rail does not
   * take, which on a 1280px screen is a 1300px-wide empty rack with `open` at the far left and
   * a name would be, later, 700px from its rating. `filling`, `balanced` and `result` fill that
   * width with content and are untouched; the empty rack does not, so it keeps the cap the
   * grid table gives every other single column.
   */
  const idle = state.kind === 'idle';

  return (
    <div className={idle ? 'cn-grid cn-grid-rail cn-grid-idle' : 'cn-grid cn-grid-rail'}>
      <main className="cn-col">
        <StatusStrip snapshot={snapshot} header={header} />

        {snapshot.seasonActive ? null : (
          // Directly under the strip, not at the foot of a 977px page: it is the reason the
          // numbers below it are not being saved, and a reader who has to scroll to find that
          // out has already read the numbers. **This page's own sentence** (M3.17): the admin
          // one ends by naming a page most of the people holding this link cannot open.
          <p className="cn-notice" role="status">
            {NO_ACTIVE_SEASON_TONIGHT_MESSAGE}
          </p>
        )}

        {/*
         * **Above the rack, directly under the strip's sentence** (the designer, 2026-09-10):
         * ten empty seats are 480px, so a button under them is under the fold on the phone
         * this page is designed for, and on an idle page it is the only thing to do.
         */}
        {state.kind === 'idle' ? (startLobby ?? startSignIn) : null}
        {idle ? <MysteryHome mystery={mystery} /> : null}
        {state.kind === 'idle' ? <Idle /> : null}
        {state.kind === 'filling' ? (
          <section className="cn-block">
            <SeatRack members={state.lobby.members} viewerPuuid={seatViewer.puuid} />
            {/* The readout, under the rack it is about: how many were invited, or a create
                that failed. No button — there is a lobby already. */}
            {startLobby}
            <MissedInvite lobby={state.lobby} linked={linked} />
          </section>
        ) : null}
        {state.kind === 'teams' ? (
          <TeamsBlock lobby={state.lobby} teams={state.teams} viewer={seatViewer} linked={linked} />
        ) : null}
        {state.kind === 'result' ? (
          <ResultBlock result={state.result} teams={state.teams} viewerPuuid={seatViewer.puuid} />
        ) : null}

        {/* M3.10's one quiet line, under the block and never per row. */}
        {hasNamelessRow(state) ? <p className="cn-hint">{NAMELESS_HINT}</p> : null}

        {idle ? null : <MysteryHome mystery={mystery} />}

        {/*
         * `Your role tonight`, and the `That's me` list behind it (M3.6). **Last in the
         * column, in every state**, so appearing or disappearing cannot move the primary
         * block: five 44px targets do not fit inside a 44px rack row, and the rack is ten
         * rows at every count. It draws nothing at all for the common case — a visitor who
         * is not signed in and no live lobby.
         */}
        <RoleTonight lobby={snapshot.lobby} viewer={viewer} onViewerChanged={onViewerChanged} />
      </main>

      <aside className="cn-rail" aria-label="About this page">
        {/* The same five rows as the top of `/leaderboard`, from the same query and the same
            sort: a rail that disagreed with the page it links to about who is first would be
            worse than a rail with two cards in it. */}
        <TopOfBoard rows={topPlayers} viewerPuuid={seatViewer.puuid} />
        <HowThisWorksCard />
        <CompanionCard />
      </aside>
    </div>
  );
}

/**
 * The status strip (05-design.md, "The status strip"): slug, headline, live pill, sentence.
 *
 * The `<h1>` is the wordmark in the shell, so the headline here is a `<p>` — there is one page
 * title and it is the product's name, not the state of a lobby.
 */
function StatusStrip({
  snapshot,
  header,
}: {
  snapshot: TonightSnapshot;
  header: ReturnType<typeof tonightHeader>;
}) {
  return (
    <header className="cn-strip">
      {/*
       * The line that tells a friend from WhatsApp what they are looking at and when: **the
       * night, and nothing else** (M5.12, product 2026-09-10). It carried `· Season 1` until
       * seasons left the friend-facing vocabulary — on the deployment that exists it read
       * `TUESDAY 9 SEPTEMBER · GAMESD`, which is the user's own season name shouted at twenty
       * people who never chose it. Formatted on the server, in one locale and the configured
       * timezone.
       */}
      <p className="cn-num cn-slug">{snapshot.nightLabel}</p>

      <p className="cn-headline-row">
        {header.count === null ? null : <span className="cn-display cn-count">{header.count}</span>}
        <span className="cn-display cn-headline">{header.headline}</span>
        {header.live ? <LivePill /> : null}
      </p>

      {/*
       * The page's one polite live region, with two lines of `t-sm` reserved: the sentence
       * changes with the count — the one text that changes without a state change — and the
       * block under it must not move while it does.
       */}
      <p className="cn-sentence" aria-live="polite">
        {header.sentence}
      </p>
    </header>
  );
}

/**
 * The one glow and the one pulse in the product. The word is the accessible text and the dot
 * is decoration: a pulsing orange circle that nothing names means nothing.
 *
 * It means **the lobby is open**, not that a socket is up. The page has no idea whether the
 * companion is still running and must not pretend to.
 */
function LivePill() {
  return (
    <span className="cn-live">
      <span className="cn-live-dot" aria-hidden="true" />
      <span className="cn-num cn-live-word">live</span>
    </span>
  );
}

/**
 * Today's Daily Mystery on `/`. Idle nights put it above the empty rack: ten
 * seats are 480px, and a card under them is under the fold on the phone this
 * page is designed for. A live lobby keeps the primary block first.
 */
function MysteryHome({ mystery }: { mystery: MysteryPageState | null }) {
  if (mystery === null) return null;
  return (
    <section className="cn-block cn-mystery-home">
      <MysteryLive initial={mystery} />
    </section>
  );
}

/**
 * No lobby tonight. The strip has said `NOBODY IN YET` and the shipped sentence; this is an
 * empty rack — the shape the page will have in an hour — and the two cards the desktop rail
 * carries, inline below 1080px, because on a phone there is nothing else to read. Where the
 * rail is on screen they are in it, and `tonight.css` hides the inline pair rather than saying
 * the same two things twice.
 */
function Idle() {
  return (
    <section className="cn-block">
      <SeatRack members={[]} viewerPuuid={null} />
      <div className="cn-idle-cards">
        <HowThisWorksCard />
        <CompanionCard />
      </div>
    </section>
  );
}

interface Viewer {
  puuid: string | null;
  isAdmin: boolean;
}

/**
 * `balanced` and `in_game` render the identical block: the sit-out strip, the two cards blue
 * first, then the explanation line. Only the headline word and the live pill differ, and the
 * cards do not re-render, re-fetch or fade on the way between them.
 */
function TeamsBlock({
  lobby,
  teams,
  viewer,
  linked,
}: {
  lobby: LobbyView;
  teams: TeamsView;
  viewer: Viewer;
  linked: boolean;
}) {
  return (
    <section className="cn-block">
      <SitOutNotice sitters={teams.sitters} viewerPuuid={viewer.puuid} />
      <div className="cn-cards">
        <TeamCard side="blue" seats={teams.blue} viewerPuuid={viewer.puuid} />
        <TeamCard side="red" seats={teams.red} viewerPuuid={viewer.puuid} />
      </div>
      {/*
       * The side line (M4.7 (b)), in **`balanced` only** (product, 2026-09-11): once the game has
       * launched there is no lobby to move in, and `Move to your side in the lobby.` names a room
       * that no longer exists. The same rule M4.10's line one element down follows, for the same
       * reason — and `teams` also draws a **finished** game the fold did not rate, with the teams
       * still up under `GAME OVER`, which the status gate rules out too.
       *
       * **And it goes when the sides are right** (M4.11, M4.3's acceptance 7). An instruction
       * everybody has already followed is a line that teaches a reader to stop reading this
       * page's lines. The moment the companion's next lobby post has all ten on the sides the
       * split gave them, the element is gone — not hidden, not a reserved gap — and the
       * explanation strip closes up under the cards. The cards themselves do not know this
       * happened: nothing in `TeamCard` reads `liveSide`, so the markup either side of the
       * change is identical and the one thing that moves on screen is the line itself.
       */}
      {lobby.status === 'balanced' && anySeatOnTheWrongSide(teams) ? <SideLine /> : null}
      <Explanation
        lobby={lobby}
        teams={teams}
        // The control is drawn for an admin while there are teams to reroll. The route checks
        // the session again before it writes; this only decides whether a button is on screen.
        showReroll={viewer.isAdmin && lobby.status === 'balanced'}
      />
      {/*
       * Still true while the teams are up and people are moving to their sides, and **gone the
       * moment the game starts**, when there is nothing left to join (M4.10). `in_game` renders
       * this same block, so the line is gated on the status and not on the block.
       */}
      {lobby.status === 'balanced' ? <MissedInvite lobby={lobby} linked={linked} /> : null}
    </section>
  );
}

/**
 * `Missed the invite? The lobby is Customs 09 Sep #1, password 4821.` (M4.10).
 *
 * The one thing on this page that is not a scoreboard: a friend whose invite popup expired, or
 * who opened League late, can join by hand from the client's own lobby list. The name and the
 * password are **data**, so they are mono; the sentence around them is language, so it is
 * Archivo.
 *
 * **Only for a signed-in viewer matched to a player row** (product and the designer,
 * 2026-09-10). The password is not a secret among the twenty people who play, and it is in the
 * Discord embed already — but this page's link gets forwarded, and a page that hands a lobby
 * password to whoever opens it is a page that invites a stranger into the game. Anonymous and
 * signed-in-but-unlinked visitors get **no element at all**, not a hidden one.
 *
 * With no name there is nothing to say — a password with no lobby to type it into is not an
 * instruction — so the whole element is absent, exactly as the copy table says.
 */
function MissedInvite({ lobby, linked }: { lobby: LobbyView; linked: boolean }) {
  if (!linked || lobby.lobbyName === null) return null;

  return (
    <p className="cn-missed">
      {MISSED_INVITE_LEAD}
      <span className="cn-num">{lobby.lobbyName}</span>
      {lobby.lobbyPassword === null ? null : (
        <>
          {MISSED_INVITE_PASSWORD}
          {/* One tap selects all four digits on a phone, not one of them. */}
          <span className="cn-num cn-missed-password">{lobby.lobbyPassword}</span>
        </>
      )}
      {MISSED_INVITE_END}
    </p>
  );
}

/**
 * Above the cards, never below: if you are sitting out, everything under it is not about you,
 * and you should learn that before you scan for your name. The card is its 3px brand rule and
 * the sentence — no header bar over it, which was the same words twice; the sentences
 * themselves are unchanged.
 */
function SitOutNotice({
  sitters,
  viewerPuuid,
}: {
  sitters: readonly MemberView[];
  viewerPuuid: string | null;
}) {
  if (sitters.length === 0) return null;
  const youSit = viewerPuuid !== null && sitters.some((member) => member.puuid === viewerPuuid);

  return (
    // No header bar: the 3px brand rule and the sentence are the card (the designer,
    // 2026-09-09). `SITTING OUT` over `Sitting out this game: …` was the same words twice.
    <section className="cn-card cn-sitout">
      <p className="cn-sitout-text">
        {youSit ? SIT_OUT_VIEWER : sitOutGeneral(joinWebNames(sitters.map((member) => member.name)))}
      </p>
    </section>
  );
}

/**
 * One side. The 4px side rule is on the **leading edge** — the top when the cards are stacked,
 * the left when they are side by side — the header bar is `raise` with the side colour on the
 * name only, and the body carries the 10% tint. Never a filled side-coloured block behind five
 * names.
 */
function TeamCard({
  side,
  seats,
  viewerPuuid,
}: {
  side: 'blue' | 'red';
  seats: readonly SeatView[];
  viewerPuuid: string | null;
}) {
  const sum = seats.reduce((total, seat) => total + seat.rating, 0);
  /**
   * **The amber threshold, per card** (the designer, 2026-09-10). Three of five is the
   * majority: below it the marked seats are the minority and colour is the fastest way to find
   * them, at or above it colour is spread over most of the card and points at nothing — and a
   * card with four amber role words stops reading as *blue* or *red* and starts reading as *the
   * amber one*, which puts the marker above the identity of the thing it marks.
   *
   * Only the icon-and-word pair gives up its colour. The dotted underline, the dot before the
   * name, the hidden `off-role` and this header's legend all stay: an underline is a shape and
   * not a hue, and the explanation line under the cards names every marked seat in a sentence.
   * Each card counts its own five — a red seat may not change colour because of blue.
   */
  const marked = seats.filter((seat) => seat.offRole).length;
  const many = marked >= OFF_ROLE_COLOUR_LIMIT;

  return (
    <section className={`cn-card cn-team cn-team-${side}${many ? ' cn-team-many-off' : ''}`}>
      <header className="cn-card-head cn-team-head">
        {/* The leading group. The sum stays the header's second and last flex child, so adding
            the legend cannot move it: blue with no legend and red with one keep their sums on
            their own card's right edge. */}
        <div className="cn-team-heading">
          <h2 className="cn-display cn-side">{side === 'blue' ? 'BLUE' : 'RED'}</h2>
          {marked === 0 ? null : (
            <>
              <span className="cn-num cn-head-sep" aria-hidden="true">
                {HEAD_SEPARATOR}
              </span>
              {/* The key to the amber dot on the rows below, and the header's only amber. */}
              <p className="cn-num cn-off-legend">
                <span className="cn-off-dot" aria-hidden="true" />
                {OFF_ROLE_LEGEND}
                <span className="cn-sr">{OFF_ROLE_LEGEND_SUFFIX}</span>
              </p>
            </>
          )}
        </div>
        <p className="cn-num cn-sum">
          {sum}
          <span className="cn-sr"> sum of the five ratings</span>
        </p>
      </header>
      <ul className="cn-seats">
        {seats.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <RoleCell role={seat.role} offRole={seat.offRole} />
            <span className="cn-seat-name">
              {seat.offRole ? <span className="cn-off-dot" aria-hidden="true" /> : null}
              {renderWebName(seat.name)}
              {seat.offRole ? <span className="cn-sr"> off-role</span> : null}
            </span>
            <span className="cn-num cn-seat-rating">{seat.rating}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Icon and word, always both (05-design.md, "Iconography"). Off-role turns the pair `brand`
 * and dots the word's underline — colour is never the only signal, and the stored explanation
 * names them in a sentence anyway.
 */
function RoleCell({ role, offRole = false }: { role: RoleValue | null; offRole?: boolean }) {
  if (role === null) return <span className="cn-num cn-seat-role" />;

  return (
    <span className={offRole ? 'cn-num cn-seat-role cn-off' : 'cn-num cn-seat-role'}>
      <RoleIcon role={role} />
      {role}
    </span>
  );
}

/**
 * The explanation strip: `splits.explanation` of the promoted split, **verbatim**, as a single
 * paragraph. Never re-composed from the split's numbers, never chopped into chips, never
 * truncated. Three lines of wrap on a phone is the correct outcome.
 *
 * After a reroll the same element re-renders with the promoted split's stored string, off-role
 * clause and all (M3.7). The reroll control stays here and not in the top bar: the button
 * means "give me a different version of *this sentence*".
 */
function Explanation({
  lobby,
  teams,
  showReroll,
}: {
  lobby: LobbyView;
  teams: TeamsView;
  showReroll: boolean;
}) {
  return (
    <div className="cn-card cn-explain">
      <p className="cn-explain-text">{teams.explanation}</p>
      {showReroll ? <RerollControl lobbyId={lobby.id} splits={teams.splits} /> : null}
    </div>
  );
}

/**
 * The result (`finished`). The headline card — winner, duration, the honest prediction line and
 * top damage — then the two team cards with **after** ratings and deltas, then the explanation
 * line of the split they played.
 *
 * **One rating per player per screen.** The cards inside this block are the only cards; there
 * is no second pair underneath with the before numbers (M3.4, M3.16).
 */
function ResultBlock({
  result,
  teams,
  viewerPuuid,
}: {
  result: ResultView;
  teams: TeamsView | null;
  viewerPuuid: string | null;
}) {
  const winner = result.winningSide === 100 ? 'BLUE' : 'RED';
  const prediction = favoredClause(result.blueWinProb);

  return (
    <section className="cn-block">
      <section className="cn-card cn-result">
        <p className="cn-result-head">
          {/* The one place in the product where a colour is large, and it is large for one
              line. The strip says `GAME OVER`; this says who won, and neither repeats the
              other (M3.16, and product 2026-09-09). */}
          <span
            className={
              result.winningSide === 100 ? 'cn-display cn-win cn-win-blue' : 'cn-display cn-win cn-win-red'
            }
          >
            {`${winner} WINS`}
          </span>
          <span className="cn-num cn-duration">{formatDuration(result.durationS)}</span>
        </p>
        {prediction === null ? null : <p className="cn-prediction">{prediction}</p>}
        {result.topDamage === null ? null : (
          // A fact about the game, inside the game's own card.
          <p className="cn-damage">
            {`Top damage: ${renderWebName(result.topDamage.name)}, `}
            <span className="cn-num cn-damage-value">{formatDamage(result.topDamage.damage)}</span>
          </p>
        )}
      </section>

      <div className="cn-cards">
        <ResultCard
          side="blue"
          seats={result.blue}
          losing={result.winningSide !== 100}
          viewerPuuid={viewerPuuid}
        />
        <ResultCard
          side="red"
          seats={result.red}
          losing={result.winningSide !== 200}
          viewerPuuid={viewerPuuid}
        />
      </div>

      {teams === null ? null : (
        <div className="cn-card cn-explain">
          <p className="cn-explain-text">{teams.explanation}</p>
        </div>
      )}
    </section>
  );
}

/**
 * One side of the result. Lane order, the same five positions as the teams block, so "my row"
 * is where it was. The winner keeps its 4px side rule and gains a 1px `brand` ring; the loser's
 * rule drops to a hairline. Two signals, both structural.
 *
 * **The delta is computed here, at render.** `displayDelta` returns `-0` for a rating that fell
 * by less than half a point, and `-0` does not survive `JSON.stringify`: carried through a
 * payload it would print `(+0)` on a row that went down (`05-design.md`).
 */
function ResultCard({
  side,
  seats,
  losing,
  viewerPuuid,
}: {
  side: 'blue' | 'red';
  seats: readonly ResultSeatView[];
  losing: boolean;
  viewerPuuid: string | null;
}) {
  const rows = seats.map((seat) => ({
    seat,
    rating: seat.muAfter === null ? null : displayRating(seat.muAfter),
    delta: seat.muBefore === null || seat.muAfter === null ? null : displayDelta(seat.muBefore, seat.muAfter),
  }));

  return (
    <section className={`cn-card cn-team cn-team-${side}${losing ? ' cn-team-lost' : ' cn-team-won'}`}>
      {/*
       * **No side sums here.** The sum answers "are these teams even?", which is a question
       * the game has just answered, and a reader who saw `6000` before and `6465` after has
       * computed a team total of deltas by subtraction — the one number this page must not
       * print (05-design.md, "Result card"). The teams block keeps its sums; this header is
       * the side name alone.
       */}
      <header className="cn-card-head cn-team-head">
        <h2 className="cn-display cn-side">{side === 'blue' ? 'BLUE' : 'RED'}</h2>
      </header>
      <ul className="cn-seats">
        {rows.map(({ seat, rating, delta }) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <RoleCell role={seat.role} />
            <span className="cn-seat-name">{renderWebName(seat.name)}</span>
            <span className="cn-num cn-seat-rating">
              {rating ?? ''}
              {delta === null ? null : (
                // One string, not three children: React separates adjacent text nodes with
                // `<!-- -->` in the server render, and a rating copied off the page should
                // read `1512 (+43)`.
                <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
                  {` (${formatWebDelta(delta)})`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
