import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CONNECT_AGAIN,
  CONNECT_DISCORD,
  CONNECT_LINE,
  DISCORD_JUST_CONNECTED,
  DISCORD_NOT_CONNECTED,
  DISCORD_STATE_CONNECTED,
  DISCORD_STATE_NOT_CONNECTED,
  DISCORD_STATE_TEST_FAILED,
  DISCORD_UNTESTED,
  discordTestedLine,
  discordTestFailed,
  PASTE_SUMMARY,
} from '@/lib/admin/sectionCopy';
import { timeAgo } from '@/lib/admin/timeAgo';
import { CONNECT_FAILED } from '@/lib/discord/connect';
import { PasteWebhookForm, SendTestButton } from './DiscordControls';

export interface DiscordStatus {
  connected: boolean;
  guildId: string | null;
  testPostAt: string | null;
  testPostError: string | null;
}

/** What `?discord=` said on the way back from Discord (M14.20). Only the three known words count. */
export type ConnectResult = 'connected' | 'test_failed' | 'failed' | null;

/**
 * `/g/<slug>/admin/discord`'s body (M14.23; STRATEGY 3.2 step 2). The four states, from the database
 * and the callback's word:
 *
 * - **not connected**: `Connect Discord` (a link to M14.20's `/api/admin/discord/connect`), the
 *   permission line, and `Or paste a webhook link instead` as a native disclosure;
 * - **connected**: `Done · test post sent <time ago>`, `Send a test post`, `Connect a different channel`;
 * - **cancelled**: back from Discord with nothing, `Discord wasn't connected. …` in place;
 * - **failed test**: Discord's reason, read from the database (never from the URL, so a crafted link
 *   cannot put words on the page).
 *
 * The voice-split settings are gone (M4.4 dropped). The operator reads the state with no control.
 */
export function DiscordView({
  groupId,
  status,
  result,
  readOnly,
  now,
}: {
  groupId: string;
  status: DiscordStatus;
  result: ConnectResult;
  readOnly: boolean;
  now: Date;
}) {
  const connectHref = `/api/admin/discord/connect?groupId=${encodeURIComponent(groupId)}`;
  const tested = status.connected && status.testPostAt !== null;
  const failedTest = status.connected && status.testPostAt === null && status.testPostError !== null;

  return (
    <>
      {result === 'failed' ? (
        <p role="alert" className="rounded-card border border-destructive px-(--card-pad) py-3 text-base">
          {CONNECT_FAILED}
        </p>
      ) : null}
      {result === 'connected' && tested ? (
        <p role="status" className="rounded-card border border-border bg-card px-(--card-pad) py-3 font-bold">
          {DISCORD_JUST_CONNECTED}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {failedTest
              ? DISCORD_STATE_TEST_FAILED
              : status.connected
                ? DISCORD_STATE_CONNECTED
                : DISCORD_STATE_NOT_CONNECTED}
          </CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3 px-(--card-pad) pb-(--card-pad)">
          {!status.connected ? <p className="text-base">{DISCORD_NOT_CONNECTED}</p> : null}
          {tested && status.testPostAt !== null ? (
            <p className="text-base">
              <span className="font-bold">{discordTestedLine(timeAgo(status.testPostAt, now))}</span>
            </p>
          ) : null}
          {failedTest ? (
            <p role="alert" className="rounded-control border border-destructive px-3 py-2 text-base">
              {discordTestFailed(status.testPostError ?? '')}
            </p>
          ) : null}
          {status.connected && !tested && !failedTest ? (
            <p className="text-base text-muted-foreground">{DISCORD_UNTESTED}</p>
          ) : null}

          {readOnly ? null : (
            <>
              {status.connected ? <SendTestButton groupId={groupId} /> : null}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  asChild
                  variant={status.connected ? 'secondary' : 'default'}
                  className="w-full md:w-auto md:self-start"
                >
                  <a href={connectHref}>{status.connected ? CONNECT_AGAIN : CONNECT_DISCORD}</a>
                </Button>
                <p className="text-sm text-muted-foreground">{CONNECT_LINE}</p>
              </div>
            </>
          )}
        </div>
      </Card>

      {readOnly ? null : (
        <details className="group rounded-card border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-(--card-pad) py-3 font-bold">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              className="size-5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            >
              <path
                d="m9 6 6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            {PASTE_SUMMARY}
          </summary>
          <div className="border-t border-border p-(--card-pad)">
            <PasteWebhookForm groupId={groupId} />
          </div>
        </details>
      )}
    </>
  );
}
