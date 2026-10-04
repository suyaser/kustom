import { SETTLING_GAMES } from '@customs/core';
import { useId } from 'react';
import { NameText } from '@/components/names/name-text';
import { Chip } from '@/components/ui/chip';
import { PLAYERS_PER_GAME } from '@/lib/lobbyRules';
import { FLEXIBLE_ROLE } from '@/lib/tonight/copy';
import { tonightRoles } from '@/lib/tonight/roles';
import { seatStanding, stillNeeded } from '@/lib/tonight/screen';
import {
  NEW_TAG,
  openSeatsLine,
  ROSTER_TITLE,
  rosterCount,
  STILL_NEEDED,
  settlingChip,
  YOU_SR,
  YOU_TAG,
} from '@/lib/tonight/screenCopy';
import type { MemberView } from '@/lib/tonight/types';
import { cn } from '@/lib/utils';
import { RoleIcon } from '../_icons/RoleIcon';
import { JoinedNow } from './JoinedNow';

/**
 * Who is in the lobby while it fills (STRATEGY §6(a), 05-design.md 5.15 "Filling rack"): one
 * compact list in join order, **no empty rows** (the open seats are one dashed line), then
 * `Still needed:` with the lanes nobody mains. Each row: the name (wraps, never clipped), its chips
 * (`You`, `New`, `settling · 4/10`), `joined just now` for a minute, the main role on the right.
 *
 * More than ten: everyone stays in one list; who the rotation would sit is said in a sentence under
 * it (the page's `wouldSitOut` line), never by greying a row.
 */
export function Roster({
  members,
  viewerPuuid,
}: {
  members: readonly MemberView[];
  viewerPuuid: string | null;
}) {
  const titleId = useId();
  const open = Math.max(0, PLAYERS_PER_GAME - members.length);
  const needed = stillNeeded(members);

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-card border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 px-(--card-pad) py-3">
        <h2 id={titleId} className="text-md font-bold">
          {ROSTER_TITLE}
        </h2>
        <span className="num text-sm text-muted-foreground">{rosterCount(members.length)}</span>
      </div>
      {members.length === 0 ? null : (
        <ul>
          {members.map((member) => (
            <Row key={member.puuid} member={member} you={member.puuid === viewerPuuid} />
          ))}
        </ul>
      )}
      {needed.length === 0 && open === 0 ? null : (
        <div className="flex flex-col gap-3 border-t border-border px-(--card-pad) py-3">
          {needed.length === 0 ? null : (
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
              {STILL_NEEDED}
              {needed.map((role) => (
                <span
                  key={role}
                  className="inline-flex min-h-(--chip-h) items-center gap-1.5 rounded-chip border-[1.5px] border-foreground px-2 font-mono text-xs font-medium font-stretch-85%"
                >
                  <RoleIcon role={role} size={14} />
                  {role}
                </span>
              ))}
            </p>
          )}
          {open === 0 ? null : (
            <p className="rounded-control border border-dashed border-border-strong px-3 py-2.5 text-sm text-muted-foreground">
              {openSeatsLine(open)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ member, you }: { member: MemberView; you: boolean }) {
  const { main } = tonightRoles(member);
  const standing = seatStanding(member.ratedGames);

  return (
    <li
      data-you={you ? '' : undefined}
      className={cn(
        'grid min-h-(--row-min-h) grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-t border-border px-(--card-pad) py-2.5',
        you && 'bg-you-wash outline-2 -outline-offset-2 outline-you',
      )}
    >
      <span className="min-w-0">
        <span className="block text-md font-bold [overflow-wrap:anywhere]">
          <NameText name={member.name} suffix={member.nameSuffix} />
          {you ? <span className="sr-only">{YOU_SR}</span> : null}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          {you ? (
            <Chip variant="you" className="-rotate-2">
              {YOU_TAG}
            </Chip>
          ) : null}
          {standing === 'new' ? <Chip variant="settling">{NEW_TAG}</Chip> : null}
          {standing === 'settling' && member.ratedGames !== null ? (
            <Chip variant="settling">{settlingChip(member.ratedGames, SETTLING_GAMES)}</Chip>
          ) : null}
          <JoinedNow joinedAt={member.joinedAt} />
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 pt-0.5">
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground font-stretch-85%">
          {main === null ? (
            FLEXIBLE_ROLE
          ) : (
            <>
              <RoleIcon role={main} size={14} />
              {main}
            </>
          )}
        </span>
        <span className="num text-sm font-semibold font-stretch-85%">{member.rating}</span>
      </span>
    </li>
  );
}
