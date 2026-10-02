'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  FEARLESS_OPEN,
  FEARLESS_SEARCH,
  FEARLESS_SEARCH_EMPTY,
  FEARLESS_SENTENCE,
  FEARLESS_TITLE,
  fearlessAvailable,
  fearlessBanned,
  fearlessCount,
  fearlessLaneTitle,
} from '@/lib/fearless/copy';
import {
  availableFearless,
  fearlessExact,
  fearlessIconUrl,
  fearlessLanes,
  fearlessMatches,
} from '@/lib/fearless/present';
import type { FearlessChampion, FearlessView } from '@/lib/fearless/types';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * Champions to ban next game (M10). Hidden while the pool is empty so an idle night is not
 * a card that says nothing. Live nights keep the primary block first; this sits with Daily
 * Mystery, under the teams or the result.
 *
 * M10.2: lanes, A–Z, and a find box. Typing a name is how the group checks a lock during
 * pick — the companion does not read champion select.
 *
 * M10.3: under each lane, after the bans, the roster champions still open in that lane.
 * A locked id leaves every lane. Discord keeps posting bans only.
 *
 * M11.1: every chip leads with a 24px champion icon, the one place in the product a
 * champion is drawn ("The fearless icon exception" in docs/05-design.md). The name is the
 * accessible text; the icon is `alt=""`. An unknown id or a failed load is name-only.
 *
 * Sizing (2026-10-03): the lanes sit in a grid — one column on a phone, as many 16rem
 * columns as fit above that — and each lane's `still open` tail is a disclosure, closed by
 * default, so the card is the bans plus five one-line summaries instead of the whole roster.
 * Typing in the find box opens every tail, because the box is how a pick is checked and a
 * match hidden behind a closed summary would read as "no champion matches". The closed tail
 * stays in the DOM, so the browser's own find-in-page still reaches it.
 */
export function FearlessCard({ fearless }: { fearless: FearlessView }) {
  const searchId = useId();
  const [query, setQuery] = useState('');

  const openPool = useMemo(() => availableFearless(fearless.champions), [fearless.champions]);
  const visibleBanned = useMemo(
    () => fearless.champions.filter((champion) => fearlessMatches(champion.name, query)),
    [fearless.champions, query],
  );
  const visibleOpen = useMemo(
    () => openPool.filter((champion) => fearlessMatches(champion.name, query)),
    [openPool, query],
  );
  const lanes = useMemo(() => fearlessLanes(visibleBanned, visibleOpen), [visibleBanned, visibleOpen]);
  const bannedHit = fearless.champions.find((champion) => fearlessExact(champion.name, query));
  const openHit = bannedHit ? undefined : openPool.find((champion) => fearlessExact(champion.name, query));

  if (fearless.champions.length === 0) return null;

  return (
    <section className="cn-block cn-fearless" aria-labelledby="cn-fearless-title">
      <div className="cn-fearless-head">
        <h2 className="cn-card-title" id="cn-fearless-title">
          {FEARLESS_TITLE}
        </h2>
        <p className="cn-fearless-count">{fearlessCount(fearless.champions.length)}</p>
      </div>
      <p className="cn-fearless-copy">{FEARLESS_SENTENCE}</p>
      <label className="cn-fearless-search" htmlFor={searchId}>
        <span className="cn-sr-only">{FEARLESS_SEARCH}</span>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={FEARLESS_SEARCH}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {bannedHit ? (
        <p className="cn-fearless-hit-copy" role="status">
          {fearlessBanned(bannedHit.name)}
        </p>
      ) : openHit ? (
        <p className="cn-fearless-hit-copy" role="status">
          {fearlessAvailable(openHit.name)}
        </p>
      ) : null}
      {lanes.length === 0 ? (
        <p className="cn-fearless-empty">{FEARLESS_SEARCH_EMPTY}</p>
      ) : (
        <div className="cn-fearless-lanes">
          {lanes.map((lane) => (
            <FearlessLane
              key={lane.role ?? 'other'}
              role={lane.role}
              banned={lane.banned}
              open={lane.open}
              query={query}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FearlessLane({
  role,
  banned,
  open,
  query,
}: {
  role: FearlessChampion['role'];
  banned: readonly FearlessChampion[];
  open: readonly FearlessChampion[];
  query: string;
}) {
  const title = fearlessLaneTitle(role);
  const searching = query.trim().length > 0;
  return (
    <div className="cn-fearless-lane">
      <h3 className="cn-fearless-lane-title">
        {role === null ? null : <RoleIcon role={role} />}
        <span>{title}</span>
      </h3>
      {banned.length > 0 ? <FearlessNames champions={banned} query={query} /> : null}
      {open.length > 0 ? (
        // `open` is only ever driven by the find box: React writes the attribute when
        // `searching` flips and leaves a reader's own tap alone in between.
        <details className="cn-fearless-open" open={searching}>
          <summary className="cn-fearless-open-label">
            <span>{FEARLESS_OPEN}</span>
            <span className="cn-num cn-fearless-open-count">{open.length}</span>
          </summary>
          <FearlessNames champions={open} query={query} open />
        </details>
      ) : null}
    </div>
  );
}

function FearlessNames({
  champions,
  query,
  open = false,
}: {
  champions: readonly FearlessChampion[];
  query: string;
  open?: boolean;
}) {
  return (
    <ul className="cn-fearless-list">
      {champions.map((champion) => {
        const exact = fearlessExact(champion.name, query);
        const className = [open ? 'cn-fearless-open-chip' : '', exact ? 'cn-fearless-hit' : '']
          .filter((token) => token.length > 0)
          .join(' ');
        return (
          <li key={champion.id} className={className.length > 0 ? className : undefined}>
            <FearlessIcon src={fearlessIconUrl(champion)} />
            {champion.name}
          </li>
        );
      })}
    </ul>
  );
}

function FearlessIcon({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    // A load that failed before hydration never reaches onError.
    if (img?.complete && img.naturalWidth === 0 && img.currentSrc !== '') setFailed(true);
  }, []);
  if (src === null || failed) return null;
  return (
    // biome-ignore lint/performance/noImgElement: a remote icon that must vanish on error; no optimiser, no build fetch.
    <img
      ref={ref}
      className="cn-fearless-icon"
      src={src}
      alt=""
      width={24}
      height={24}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
