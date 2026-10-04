'use client';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AI_ABOUT_YOU_BODY,
  AI_ABOUT_YOU_TITLE,
  WRITE_ABOUT_ME_LABEL,
  WRITE_ABOUT_ME_ON_DONE,
  writeAboutMeOffDone,
  writeAboutMeOffStanding,
} from '@/lib/aiLinesCopy';
import { SavedSwitch } from './SavedSwitch';

/**
 * The You page's `AI lines about you` card (M16.3b; brief 1.4, D6). Drawn by the server only for a
 * signed-in member of a Premium group with AI lines on; it never says `Premium` (D1). `Write about me`
 * is on by default and posts to `POST /api/me/ai-opt-out`, which takes the player from the session.
 * The player is the only one who can turn it back on once off.
 */
export function AiLinesAboutYou({
  groupId,
  groupName,
  writeAboutMe,
}: {
  groupId: string;
  groupName: string;
  /** The inverse of the membership's `ai_opt_out`. */
  writeAboutMe: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{AI_ABOUT_YOU_TITLE}</CardTitle>
        <p className="text-sm text-pretty text-muted-foreground">{AI_ABOUT_YOU_BODY}</p>
      </CardHeader>
      <div className="border-t border-border px-(--card-pad) py-1">
        <SavedSwitch
          id="write-about-me"
          label={WRITE_ABOUT_ME_LABEL}
          initial={writeAboutMe}
          url="/api/me/ai-opt-out"
          payloadFor={(next) => ({ groupId, writeAboutMe: next })}
          className="pb-2"
        >
          {({ checked, changed }) => (
            <>
              {/* Design round 1 (F2): loaded already off, the state is said once, not left to the switch. */}
              {!checked && !changed ? (
                <p className="text-sm text-pretty text-muted-foreground">
                  {writeAboutMeOffStanding(groupName)}
                </p>
              ) : null}
              <p role="status" className="text-sm text-pretty">
                {changed ? (checked ? WRITE_ABOUT_ME_ON_DONE : writeAboutMeOffDone(groupName)) : ''}
              </p>
            </>
          )}
        </SavedSwitch>
      </div>
    </Card>
  );
}
