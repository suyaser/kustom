import { notFound } from 'next/navigation';
import { LandingPage } from '@/components/landing/LandingPage';
import { BareShell } from '@/components/shell/BareShell';
import { Button } from '@/components/ui/button';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { landingData } from '@/lib/landing/server';
import { SIGN_IN_LABEL, SIGN_OUT_LABEL } from '@/lib/shellCopy';

/**
 * Dev-only preview of the landing page's states the local stack cannot reach on `/` (M14.24):
 * `?state=signed-in` (signed in, in no group: needs a Discord session, which the local stack
 * cannot mint without writing auth rows), `?state=example` (the demo group has no rolled game:
 * the worked example, no calibration, no game count), `?state=no-counters` (the counters' read
 * failed: the counters are hidden). Real data otherwise. Like `/kit`, a 404 in production builds.
 */
export default async function KitLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state } = await searchParams;
  const real = await landingData();
  const data =
    state === 'example'
      ? {
          ...real,
          demo: real.demo ?? ORIGINAL_GROUP,
          demoGames: null,
          hero: { kind: 'example' as const },
          calibration: null,
        }
      : state === 'no-counters'
        ? { ...real, counters: null }
        : real;
  return (
    <BareShell
      headerEnd={
        // What `KustomSignIn` draws for this audience (the kit has no session to read).
        <form action={state === 'signed-in' ? '/auth/signout' : '/auth/signin'} method="post">
          <input type="hidden" name="next" value="/" />
          <Button type="submit" variant="secondary">
            {state === 'signed-in' ? SIGN_OUT_LABEL : SIGN_IN_LABEL}
          </Button>
        </form>
      }
    >
      <LandingPage data={data} audience={state === 'signed-in' ? 'signed-in' : 'signed-out'} back={null} />
    </BareShell>
  );
}
