'use client';

import { SavedSwitch } from '@/components/premium/SavedSwitch';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import {
  AI_LINES_LABEL,
  AI_LINES_OFF_LINE,
  AI_LINES_ON_LINE,
  AI_PAUSED_CHIP,
  aiPausedLine,
  PREMIUM_SECTION_TITLE,
} from '@/lib/aiLinesCopy';

export interface PremiumSectionView {
  /** `groups.ai_lines_enabled`. */
  linesEnabled: boolean;
  /** `1 Nov` while this month's budget is used up (`aiPausedUntil`), else null. */
  pausedUntilDay: string | null;
}

/**
 * The admin home's `Kustom Premium` section (M16.3b; brief 1.5). Drawn by the server for a Premium
 * group's owner and admins only (D1): a non-Premium group, members, visitors, the unlinked creator
 * and the operator never get it. One `AI lines` switch, no confirm (off loses nothing), posting to
 * `POST /api/admin/ai-lines`, which checks the admin and the flag again. The budget line is only
 * ever here.
 */
export function PremiumSection({ groupId, view }: { groupId: string; view: PremiumSectionView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{PREMIUM_SECTION_TITLE}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-2 px-(--card-pad) pb-(--card-pad)">
        <SavedSwitch
          id="ai-lines"
          label={AI_LINES_LABEL}
          initial={view.linesEnabled}
          url="/api/admin/ai-lines"
          payloadFor={(enabled) => ({ groupId, enabled })}
        >
          {({ checked }) => (
            <p className="text-sm text-pretty text-muted-foreground">
              {checked ? AI_LINES_ON_LINE : AI_LINES_OFF_LINE}
            </p>
          )}
        </SavedSwitch>
        {view.pausedUntilDay === null ? null : (
          <div className="flex flex-col items-start gap-1.5 border-t border-border pt-3">
            <Chip>{AI_PAUSED_CHIP}</Chip>
            <p className="text-sm text-pretty text-foreground">{aiPausedLine(view.pausedUntilDay)}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
