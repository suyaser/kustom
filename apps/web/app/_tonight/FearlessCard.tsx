'use client';

import { useId, useMemo, useState } from 'react';
import {
  FEARLESS_SEARCH,
  FEARLESS_SEARCH_EMPTY,
  FEARLESS_SENTENCE,
  FEARLESS_TITLE,
  fearlessBanned,
  fearlessCount,
  fearlessLaneTitle,
} from '@/lib/fearless/copy';
import { fearlessExact, fearlessMatches, groupFearless } from '@/lib/fearless/present';
import type { FearlessChampion, FearlessView } from '@/lib/fearless/types';

/**
 * Champions to ban next game (M10). Hidden while the pool is empty so an idle night is not
 * a card that says nothing. Live nights keep the primary block first; this sits with Daily
 * Mystery, under the teams or the result.
 *
 * M10.2: lanes, A–Z, and a find box. Typing a name is how the group checks a lock during
 * pick — the companion does not read champion select.
 */
export function FearlessCard({ fearless }: { fearless: FearlessView }) {
  const searchId = useId();
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => fearless.champions.filter((champion) => fearlessMatches(champion.name, query)),
    [fearless.champions, query],
  );
  const groups = useMemo(() => groupFearless(visible), [visible]);
  const hit = fearless.champions.find((champion) => fearlessExact(champion.name, query));

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
      {hit ? (
        <p className="cn-fearless-hit-copy" role="status">
          {fearlessBanned(hit.name)}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="cn-fearless-empty">{FEARLESS_SEARCH_EMPTY}</p>
      ) : (
        groups.map((group) => (
          <FearlessLane
            key={group.role ?? 'other'}
            role={group.role}
            champions={group.champions}
            query={query}
          />
        ))
      )}
    </section>
  );
}

function FearlessLane({
  role,
  champions,
  query,
}: {
  role: FearlessChampion['role'];
  champions: readonly FearlessChampion[];
  query: string;
}) {
  const title = fearlessLaneTitle(role);
  return (
    <div className="cn-fearless-lane">
      <h3 className="cn-fearless-lane-title">{title}</h3>
      <ul className="cn-fearless-list">
        {champions.map((champion) => {
          const exact = fearlessExact(champion.name, query);
          return (
            <li key={champion.id} className={exact ? 'cn-fearless-hit' : undefined}>
              {champion.name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
