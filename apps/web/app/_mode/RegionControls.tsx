'use client';

import { type FormEvent, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { REGION_IDS, type RegionId, regionName } from '@/lib/champs/regions';
import type { RegionTarget } from '@/lib/mode/cardView';
import type { RegionWrite } from '@/lib/mode/controlsStore';
import {
  REDRAW_REGIONS,
  REGION_PAIR_SHORT,
  REGION_SELECT_LABELS,
  SET_REGION,
  TOO_FEW_OPEN,
} from '@/lib/mode/ruleCopy';

/** The 13 regions a side may be set to (the table's, `unaffiliated` left out). */
const SIDE_REGIONS: readonly RegionId[] = REGION_IDS.filter((region) => region !== 'unaffiliated');

export type RegionChange = { redraw: true } | { side: 'blue' | 'red'; region: string };

/**
 * One region pair's controls on the Mode card's admin foot (M20.10; M20.1's copy, M20 D9): the
 * next game's pair (the row, while region wars is pending) or this game's (the lock, while the
 * lobby is balanced). `Redraw regions` and the `Blue's region` / `Red's region` selects; a region
 * under 8 open for that game is a disabled `(too few open)` option, from the server's run of the
 * route's own check (`regionFacts`); the side's current region always stays selectable.
 *
 * Each control is its own `<form method="post">` to the mode route (`redraw` or
 * `side` + `region`, with `game`), so it works with no JS; with JS the parent posts it and shows
 * the route's notice. A select never posts on change: its `Set region` button shows once the
 * choice differs (always without JS), as `Set mode` does.
 */
export interface RegionControlsProps {
  target: RegionTarget;
  groupId: string;
  /** The mode route (`ModeControls` owns it: the one place that posts it). */
  action: string;
  redirectTo: string;
  /** `This game` / `Next game` after Roll; none before (the pair is the mode picker's). */
  heading: string | null;
  /** The short-pair line here (admins), when the card's status does not already say it. */
  showShort: boolean;
  /** The region write in flight, if any (one write at a time on the card). */
  pending: RegionWrite | null;
  hydrated: boolean;
  /** Posts the change; resolves true when the route took it. */
  onChange: (target: RegionTarget, change: RegionChange) => Promise<boolean>;
}

export function RegionControls({
  target,
  groupId,
  action,
  redirectTo,
  heading,
  showShort,
  pending,
  hydrated,
  onChange,
}: RegionControlsProps) {
  const { game } = target;
  return (
    <fieldset data-slot={`region-controls-${game}`} className="min-w-0">
      {heading === null ? null : <legend className="mb-2 text-xs font-bold">{heading}</legend>}
      <div className="flex flex-col gap-2">
        {showShort && target.short ? <p className="text-sm font-bold">{REGION_PAIR_SHORT}</p> : null}
        <div className="grid gap-2 @[520px]:grid-cols-2">
          {(['blue', 'red'] as const).map((side) => (
            <SideSelect
              key={side}
              side={side}
              target={target}
              groupId={groupId}
              action={action}
              redirectTo={redirectTo}
              pending={pending === `${side}-${game}`}
              hydrated={hydrated}
              onChange={onChange}
            />
          ))}
        </div>
        <form
          method="post"
          action={action}
          onSubmit={(event) => {
            event.preventDefault();
            void onChange(target, { redraw: true });
          }}
        >
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="redraw" value="true" />
          <input type="hidden" name="game" value={game} />
          <Button type="submit" variant="secondary" pending={pending === `redraw-${game}`}>
            {REDRAW_REGIONS}
          </Button>
        </form>
      </div>
    </fieldset>
  );
}

function SideSelect({
  side,
  target,
  groupId,
  action,
  redirectTo,
  pending,
  hydrated,
  onChange,
}: {
  side: 'blue' | 'red';
  target: RegionTarget;
  groupId: string;
  action: string;
  redirectTo: string;
  pending: boolean;
  hydrated: boolean;
  onChange: (target: RegionTarget, change: RegionChange) => Promise<boolean>;
}) {
  const selectId = useId();
  const current = target[side];
  const [pick, setPick] = useState<string | null>(null);
  // A new pair (an answer, another admin's write, a re-read) is what the select shows again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the pair, not on the pick.
  useEffect(() => setPick(null), [target.blue, target.red]);
  const choice = pick ?? current;
  const showSet = !hydrated || choice !== current || pending;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (choice === current) return;
    const took = await onChange(target, { side, region: choice });
    // Refused: back to what is set. Taken: the new pair clears the pick when it arrives.
    if (!took) setPick(null);
  }

  return (
    <form
      method="post"
      action={action}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="game" value={target.game} />
      <label htmlFor={selectId} className="text-xs font-bold">
        {REGION_SELECT_LABELS[side]}
      </label>
      <div className="flex gap-2">
        <NativeSelect
          id={selectId}
          name="region"
          value={choice}
          onChange={(event) => setPick(event.target.value)}
          className="w-full min-w-0 flex-1"
        >
          {SIDE_REGIONS.map((region) => {
            const small = !target.open.includes(region);
            return (
              <option key={region} value={region} disabled={small && region !== current}>
                {regionName(region)}
                {small ? TOO_FEW_OPEN : ''}
              </option>
            );
          })}
        </NativeSelect>
        {showSet ? (
          <Button type="submit" pending={pending}>
            {SET_REGION}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
