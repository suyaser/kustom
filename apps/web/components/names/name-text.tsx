import { renderWebName } from '@/lib/tonight/copy';
import type { PlayerName } from '@/lib/tonight/types';

/**
 * A person's printed name with its same-name suffix (M14.69, design review): `Ali` in the row's own
 * weight, then ` #EUW` or ` (2)` muted at weight 400. With no suffix it is just the name. A server
 * component; the suffix comes from `lib/names/roster.ts` on the row (`nameSuffix`).
 */
export function NameText({ name, suffix }: { name: PlayerName; suffix?: string | null | undefined }) {
  return (
    <>
      {renderWebName(name)}
      {suffix == null ? null : (
        <>
          {' '}
          <span className="font-normal text-muted-foreground">{suffix}</span>
        </>
      )}
    </>
  );
}
