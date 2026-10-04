'use client';

import { type ReactNode, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { SWITCH_FAILED } from '@/lib/aiLinesCopy';
import { cn } from '@/lib/utils';

/**
 * One switch that saves itself (M16.3b): a 44px row, the label on the left as a `<label>` so the whole
 * row is the target, the switch on the right. A press flips it at once and posts `payloadFor(next)`
 * as JSON to `url`; a refusal or a network failure flips it back with {@link SWITCH_FAILED} under it,
 * in place (never a toast). No confirm: the brief's switches lose nothing when flipped.
 *
 * `children(saved)` draws what sits under the row from the saved state: the state line, and after a
 * press the confirmation (`role="status"`, so it is announced once).
 */
export function SavedSwitch({
  id,
  label,
  initial,
  url,
  payloadFor,
  children,
  className,
}: {
  id: string;
  label: string;
  initial: boolean;
  url: string;
  payloadFor: (next: boolean) => Record<string, unknown>;
  children?: (state: { checked: boolean; changed: boolean }) => ReactNode;
  className?: string;
}) {
  const [checked, setChecked] = useState(initial);
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(next: boolean): Promise<void> {
    if (pending) return;
    setChecked(next);
    setPending(true);
    setError(null);
    let ok = false;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payloadFor(next)),
      });
      ok = response.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      setChanged(true);
    } else {
      setChecked(!next);
      setError(SWITCH_FAILED);
    }
    setPending(false);
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <label htmlFor={id} className="flex min-h-11 flex-1 cursor-pointer items-center font-bold">
          {label}
        </label>
        <Switch
          id={id}
          checked={checked}
          aria-disabled={pending || undefined}
          onCheckedChange={(next) => void flip(next)}
        />
      </div>
      {children?.({ checked, changed: changed && !pending })}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
