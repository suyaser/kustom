import { Button } from '@/components/ui/button';
import { SIGN_IN_LABEL, SIGN_OUT_LABEL } from '@/lib/shellCopy';
import { currentSessionPlayer } from '@/lib/viewer';

/**
 * The account control in the bare shell's top bar (STRATEGY 2.5). Signed out: `Sign in`, back to
 * `/`, which sends a member on to their group and keeps everybody else on the landing page.
 * Signed in (a visitor in no group, or anyone on `/about`, `/how`, `/download`): `Sign out`, back
 * to the page they were on. Both are forms, so they work with JavaScript off. Secondary, not
 * primary: the landing page's one primary action is `Create your group`.
 */
export async function KustomSignIn({ here = '/' }: { here?: string }) {
  const session = await currentSessionPlayer();
  const signedIn = session.kind !== 'anonymous';
  return (
    <form action={signedIn ? '/auth/signout' : '/auth/signin'} method="post">
      <input type="hidden" name="next" value={here} />
      <Button type="submit" variant="secondary" className="cursor-pointer">
        {signedIn ? SIGN_OUT_LABEL : SIGN_IN_LABEL}
      </Button>
    </form>
  );
}
