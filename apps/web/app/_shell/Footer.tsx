import Link from 'next/link';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { groupHref, RELEASES_URL } from '@/lib/nav';
import { COMPANION_LINK_LABEL, YOUR_GAMES_LABEL } from '@/lib/shellCopy';
import { HowThisWorksDetails } from './HowThisWorks';

/**
 * The footer (05-design.md, "The app shell"). One line of links, `t-sm` `dim`, a `line` rule
 * above it, and the `How this works` details beside them.
 *
 * The date and the season are the status strip's slug line and are **not** repeated here.
 *
 * `Your games` is rendered only for a signed-in viewer who has a player row, and points at
 * their own page — nineteen of the twenty people holding this link have no session, and a link
 * that answers "who am I?" with a 404 is worse than no link. It is the group's player page
 * (`lib/nav.ts`), so on a group whose player page has not moved yet there is no link at all.
 */
export function Footer({ group, viewerPuuid }: { group: PageGroup; viewerPuuid: string | null }) {
  const yourGames = viewerPuuid === null ? null : groupHref(group, { page: 'player', puuid: viewerPuuid });
  return (
    <footer className="cn-footer">
      <div className="cn-footer-inner">
        <HowThisWorksDetails />
        <nav className="cn-footer-links" aria-label="More">
          <a className="cn-link" href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
            {COMPANION_LINK_LABEL}
          </a>
          {yourGames === null ? null : (
            <Link className="cn-link" href={yourGames}>
              {YOUR_GAMES_LABEL}
            </Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
