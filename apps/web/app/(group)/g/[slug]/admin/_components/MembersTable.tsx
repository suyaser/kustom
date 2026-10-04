// biome-ignore-all lint/a11y/useSemanticElements: one markup is a table from 768 and one-line rows below it (05-design 5.12); a `display: block` <table> loses its semantics in Safari, so the roles are explicit on divs.
// biome-ignore-all lint/a11y/useFocusableInteractive: table rows and cells are not interactive; their role is structure, read with table navigation.
'use client';

import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { GroupMemberRow } from '@/lib/admin/groupMembers';
import {
  CLEAR_LABEL,
  COLUMN_ACTIONS,
  COLUMN_GAMES,
  COLUMN_LAST_PLAYED,
  COLUMN_NAME,
  COLUMN_ROLE,
  CONFIRM_UNLINK_ADMIN_DISCORD_BODY,
  CONFIRM_UNLINK_DISCORD_BODY,
  CONFIRM_UNLINK_OWN_DISCORD_BODY,
  CONFIRM_UNLINK_OWN_DISCORD_TITLE,
  confirmUnlinkDiscordTitle,
  FIND_SOMEONE_LABEL,
  gamesCount,
  LAST_PLAYED_PREFIX,
  MANAGE_LABEL,
  MEMBERS_TITLE,
  membersCount,
  NEVER_PLAYED,
  noMemberMatch,
  OWNER_ROW_NOTE,
  ROLE_WORDS,
  THIS_PLAYER,
  UNLINK_DISCORD_ACTION,
  UNLINK_DISCORD_LABEL,
  UNLINK_DISCORD_PENDING,
  YOU_CHIP,
} from '@/lib/admin/homeCopy';
import { canUnlinkDiscord, type MemberViewer, memberActions } from '@/lib/admin/memberActions';
import { filterMembers } from '@/lib/admin/memberList';
import {
  DONT_WRITE_ABOUT_ACTION,
  dontWriteAboutBody,
  dontWriteAboutLabel,
  dontWriteAboutTitle,
  NOT_IN_AI_LINES,
} from '@/lib/aiLinesCopy';
import { DEFAULT_NIGHT_TIME_ZONE, formatDayMonth, formatDayMonthYear } from '@/lib/night';
import { NAMELESS_HINT } from '@/lib/tonight/copy';
import { cn } from '@/lib/utils';
import { ConfirmAction, WarningIcon } from './ConfirmAction';
import { MemberActions } from './MemberActions';

/** The desktop grid, from 768: name, role, last played, games, and the actions when there are any. */
const COLUMNS = {
  acting: 'md:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_8rem_4.5rem_minmax(0,12rem)]',
  reading: 'md:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_8rem_4.5rem]',
} as const;

/**
 * The members list (M14.22; STRATEGY 3.5, 05-design 5.12; M14.52 for finding someone at 375). Ordered
 * by the loader (`sortMembers`: owner, admins, then last played). `Find someone` filters it as you
 * type, in the browser, with no page load and no server call.
 *
 * A table from 768; under it **one line per person** (name, then role · last played · games) with a
 * single `Manage` toggle that opens the row's actions -- the role buttons (`MemberActions`, each
 * behind its confirm) and, in a Premium group, `Don't write about <Name>` (M16.3b). Role in words,
 * never a colour. The owner row says why it has no Remove. Your own row with no name yet reads "You",
 * never a PUUID fragment. The operator gets the list with no actions.
 */
export function MembersTable({
  groupId,
  rows,
  viewer,
  aiLines = false,
  timeZone = DEFAULT_NIGHT_TIME_ZONE,
}: {
  groupId: string;
  rows: readonly GroupMemberRow[];
  viewer: MemberViewer;
  /** The group's night time zone (`nightTimeZone()` on the server), for `Last played` dates. */
  timeZone?: string;
  /**
   * M16.3b: the group is Premium, so an admin gets `Don't write about <Name>` on every other
   * member's row (one way: only the player turns it back on). False draws no AI word at all (D1).
   */
  aiLines?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const findId = useId();
  const findRef = useRef<HTMLInputElement>(null);
  // Admin round 2: a nameless row's place in the unfiltered list tells two `Someone`s apart.
  const position = new Map(rows.map((row, index) => [row.playerId, index + 1]));
  const anyNameless = rows.some((row) => !row.named);
  const viewerId = viewer.role === 'read-only' ? null : viewer.playerId;
  const acting = viewer.role !== 'read-only';
  const shown = filterMembers(rows, query);
  const asked = query.trim();
  const grid = acting ? COLUMNS.acting : COLUMNS.reading;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 md:max-w-sm">
        <Label htmlFor={findId}>{FIND_SOMEONE_LABEL}</Label>
        <div className="relative">
          <Input
            ref={findRef}
            id={findId}
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={cn('[&::-webkit-search-cancel-button]:appearance-none', query !== '' && 'pe-12')}
          />
          {query === '' ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={CLEAR_LABEL}
              className="absolute end-0 top-0"
              onClick={() => {
                setQuery('');
                findRef.current?.focus();
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="m6 6 12 12M18 6 6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Button>
          )}
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {asked === '' ? '' : shown.length === 0 ? noMemberMatch(asked) : membersCount(shown.length)}
        </p>
      </div>

      {shown.length === 0 ? null : (
        <div
          role="table"
          aria-label={MEMBERS_TITLE}
          className="flex flex-col rounded-card border border-border bg-card md:rounded-none md:border-0 md:bg-transparent"
        >
          <div role="rowgroup" className="max-md:sr-only">
            <div
              role="row"
              className={cn(
                'md:grid md:gap-x-3 md:border-b md:border-border md:px-3 md:py-2 md:text-xs md:font-bold md:text-muted-foreground',
                grid,
              )}
            >
              <span role="columnheader">{COLUMN_NAME}</span>
              <span role="columnheader">{COLUMN_ROLE}</span>
              <span role="columnheader">{COLUMN_LAST_PLAYED}</span>
              <span role="columnheader" className="md:text-end">
                {COLUMN_GAMES}
              </span>
              {acting ? <span role="columnheader">{COLUMN_ACTIONS}</span> : null}
            </div>
          </div>
          <div role="rowgroup">
            {shown.map((row) => (
              <MemberRow
                key={row.playerId}
                groupId={groupId}
                row={row}
                viewer={viewer}
                you={row.playerId === viewerId}
                position={position.get(row.playerId) ?? 0}
                timeZone={timeZone}
                aiLines={aiLines && acting}
                grid={grid}
                open={open === row.playerId}
                onToggle={() => setOpen((current) => (current === row.playerId ? null : row.playerId))}
              />
            ))}
          </div>
        </div>
      )}
      {/* Admin round 2: said once, under the list, while anyone still reads `Someone`. */}
      {anyNameless ? <p className="text-sm text-muted-foreground">{NAMELESS_HINT}</p> : null}
    </div>
  );
}

function MemberRow({
  groupId,
  row,
  viewer,
  you,
  position,
  timeZone,
  aiLines,
  grid,
  open,
  onToggle,
}: {
  groupId: string;
  row: GroupMemberRow;
  viewer: MemberViewer;
  you: boolean;
  /** 1-based place in the unfiltered list. */
  position: number;
  timeZone: string;
  aiLines: boolean;
  grid: string;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const acting = viewer.role !== 'read-only';
  const roleActions = memberActions(viewer, row);
  const aiAction = aiLines && !you && !row.aiOptOut;
  // M14.60: `Unlink Discord` when a Discord account is linked (never the owner's own row).
  const unlinkAction = canUnlinkDiscord(viewer, row);
  const manageable = roleActions.length > 0 || aiAction || unlinkAction;
  // N3: only the owner needs telling why their own row has no Remove.
  const ownerNote = viewer.role === 'owner' && row.role === 'owner' && roleActions.length === 0;
  // A member with no name yet is `this player` inside a sentence, `Someone` everywhere else.
  const spoken = row.named ? row.name : THIS_PLAYER;
  const manageName = row.named
    ? `${MANAGE_LABEL} ${row.name}`
    : `${MANAGE_LABEL} ${row.name}, row ${position}`;
  const firstActions = roleActions.filter((action) => action !== 'remove');
  const removable = roleActions.includes('remove');
  // M14.69: the roster-wide same-name suffix (`#EUW`, `(2)`); a name that is already a Riot ID
  // (`Name#TAG`, no display name yet) carries its tag and needs none.
  const suffix =
    row.nameSuffix && !(row.nameSuffix.startsWith('#') && row.name.includes('#')) ? row.nameSuffix : null;

  return (
    <div
      role="row"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-border px-(--card-pad) py-2 first:border-t-0',
        'md:gap-y-0 md:border-t-0 md:border-b md:px-3',
        grid,
      )}
    >
      <div className="contents">
        <span
          role="rowheader"
          className="col-start-1 row-start-1 font-bold max-md:[overflow-wrap:anywhere] md:col-auto md:row-auto"
        >
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>
              {row.name}
              {suffix === null ? null : (
                <>
                  {' '}
                  <span className="font-normal text-muted-foreground">{suffix}</span>
                </>
              )}
            </span>
            {/* A real space, so the row reads "Hana You", not "HanaYou"; the flex gap draws it. */}
            {you ? ' ' : null}
            {you ? <Chip variant="you">{YOU_CHIP}</Chip> : null}
          </span>
        </span>
        <div className="col-span-full row-start-2 flex flex-wrap gap-x-1.5 text-sm text-muted-foreground md:contents md:text-base md:text-foreground">
          <span role="cell">
            {ROLE_WORDS[row.role]}
            {aiLines && row.aiOptOut ? (
              <span className="text-muted-foreground">
                <span aria-hidden="true"> · </span>
                {NOT_IN_AI_LINES}
              </span>
            ) : null}
          </span>
          <span role="cell" className={cn('whitespace-nowrap', row.lastPlayedAt === null && 'max-md:hidden')}>
            <span aria-hidden="true" className="md:hidden">
              {`· ${LAST_PLAYED_PREFIX} `}
            </span>
            {row.lastPlayedAt === null ? (
              NEVER_PLAYED
            ) : (
              <PlayedOn at={row.lastPlayedAt} timeZone={timeZone} />
            )}
          </span>
          <span role="cell" className="whitespace-nowrap md:text-end">
            <span aria-hidden="true" className="md:hidden">
              {'· '}
            </span>
            <span className="md:hidden">{gamesCount(row.games)}</span>
            <span className="num max-md:hidden">{row.games}</span>
          </span>
        </div>
      </div>

      {acting ? (
        <span
          role="cell"
          className={cn(
            'col-start-2 row-start-1 justify-self-end md:col-auto md:row-auto md:justify-self-start md:py-1',
            ownerNote &&
              !manageable &&
              'max-md:col-span-full max-md:col-start-1 max-md:row-start-3 max-md:justify-self-start',
          )}
        >
          {manageable ? (
            <Button
              type="button"
              variant="secondary"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={manageName}
              onClick={onToggle}
            >
              {MANAGE_LABEL}
              <Chevron open={open} />
            </Button>
          ) : ownerNote ? (
            <span className="text-sm text-muted-foreground">{OWNER_ROW_NOTE}</span>
          ) : null}
        </span>
      ) : null}

      {manageable && open ? (
        <div
          id={panelId}
          role="cell"
          // N4: role changes, then Unlink Discord (M14.60), then Don't write about, then Remove last;
          // full width under 768.
          className="col-span-full row-start-3 flex flex-col gap-2 pt-1 pb-2 max-md:[&_button]:w-full max-md:[&>div]:flex-col md:row-auto md:flex-row md:flex-wrap"
        >
          {firstActions.length > 0 ? (
            <MemberActions groupId={groupId} playerId={row.playerId} name={spoken} actions={firstActions} />
          ) : null}
          {unlinkAction ? <UnlinkDiscordControl groupId={groupId} row={row} name={spoken} you={you} /> : null}
          {aiAction ? <AiOptOutControl groupId={groupId} playerId={row.playerId} name={spoken} /> : null}
          {removable ? (
            <MemberActions groupId={groupId} playerId={row.playerId} name={spoken} actions={['remove']} />
          ) : null}
          {ownerNote ? <p className="text-sm text-muted-foreground">{OWNER_ROW_NOTE}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** M16.3b: an admin's one-way `Don't write about <Name>`, behind its confirm. */
function AiOptOutControl({ groupId, playerId, name }: { groupId: string; playerId: string; name: string }) {
  return (
    <div>
      <ConfirmAction
        label={dontWriteAboutLabel(name)}
        tone="secondary"
        title={dontWriteAboutTitle(name)}
        body={dontWriteAboutBody(name)}
        actionLabel={DONT_WRITE_ABOUT_ACTION}
        url="/api/admin/members/ai-opt-out"
        payload={{ groupId, playerId, optOut: true }}
      />
    </div>
  );
}

/**
 * M14.60: `Unlink Discord`, behind its confirm (focus on Cancel). The link is the player's, so the
 * confirm says it reaches every group they're in. Without JavaScript the `<noscript>` button posts
 * the same form to the route, which sends the page back with the notice or the refusal.
 */
function UnlinkDiscordControl({
  groupId,
  row,
  name,
  you,
}: {
  groupId: string;
  row: GroupMemberRow;
  /** The row's name in a sentence: `this player` for a member with no name yet. */
  name: string;
  you: boolean;
}) {
  return (
    <form method="post" action="/api/admin/members/unlink-discord">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="playerId" value={row.playerId} />
      <ConfirmAction
        label={UNLINK_DISCORD_LABEL}
        tone="destructive"
        title={you ? CONFIRM_UNLINK_OWN_DISCORD_TITLE : confirmUnlinkDiscordTitle(name)}
        body={unlinkBody(row, you)}
        actionLabel={UNLINK_DISCORD_ACTION}
        pendingLabel={UNLINK_DISCORD_PENDING}
        url="/api/admin/members/unlink-discord"
        payload={{ groupId, playerId: row.playerId }}
      />
      <noscript>
        <Button type="submit" variant="destructive">
          <WarningIcon />
          {UNLINK_DISCORD_LABEL}
        </Button>
      </noscript>
    </form>
  );
}

/**
 * Which consequence the confirm states (round 2): yourself (an admin; the owner never gets the control),
 * another admin (no `That's me` tap for admins: they pair again from the invite link), or a member.
 */
function unlinkBody(row: GroupMemberRow, you: boolean): string {
  if (you) return CONFIRM_UNLINK_OWN_DISCORD_BODY;
  return row.role === 'member' ? CONFIRM_UNLINK_DISCORD_BODY : CONFIRM_UNLINK_ADMIN_DISCORD_BODY;
}

/** `3 Oct` in a phone row's one line, `3 Oct 2026` in the desktop column. */
/** `8 Sep` on a phone, `8 Sep 2026` wider: `lib/night.ts`'s formats, in the group's time zone. */
function PlayedOn({ at, timeZone }: { at: string; timeZone: string }) {
  const when = new Date(at);
  return (
    <>
      <span className="md:hidden">{formatDayMonth(when, timeZone)}</span>
      <span className="max-md:hidden">{formatDayMonthYear(when, timeZone)}</span>
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('transition-transform duration-(--dur-fast)', open && 'rotate-180')}
    >
      <path
        d="m6 9 6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
