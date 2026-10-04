'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SORT_LABEL, SORT_SUBMIT, sortOptionLabel } from '@/lib/board/copy';
import { BOARD_SORTS, type BoardSort } from '@/lib/board/order';
import type { WindowKind } from '@/lib/night';

/**
 * The board's sort (STRATEGY §6(b)): a native select in a GET form (05-design 5.0, "keep native"),
 * so the URL owns the state and it works without JavaScript. With JavaScript, choosing an option
 * submits the form; without it, the `Sort` button inside `<noscript>` does.
 *
 * On a week the default option reads `Points` (M14.57: week boards rank by net points); the URL
 * value is `rating` on every window. The window rides along as a hidden field, and the page resets to 1 (a new order starts at the
 * top).
 */
export function SortSelect({
  action,
  window,
  sort,
}: {
  action: string;
  window: WindowKind;
  sort: BoardSort;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="window" value={window} />
      <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:min-w-48">
        <Label htmlFor="board-sort">{SORT_LABEL}</Label>
        <NativeSelect
          id="board-sort"
          name="sort"
          defaultValue={sort}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {BOARD_SORTS.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {sortOptionLabel(option, window)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <noscript>
        <Button type="submit" variant="secondary">
          {SORT_SUBMIT}
        </Button>
      </noscript>
    </form>
  );
}
