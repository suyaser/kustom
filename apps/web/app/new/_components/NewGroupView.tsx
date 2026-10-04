import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NEW_SIGNED_OUT_LINE, NEW_TITLE } from '@/lib/groups/pageCopy';
import { SIGN_IN_WITH_DISCORD_LABEL } from '@/lib/shellCopy';
import { NewGroupForm } from './NewGroupForm';

/**
 * `/new`'s body (M13.13, M14.21; STRATEGY 3.2 step 1), a 2.0 root under the bare shell. One thing on
 * the page: `Start a group`. Signed out, the heading and the Discord sign-in, coming back here.
 */
export function NewGroupView({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-8 *:max-w-xl lg:py-16">
        <h1 className="font-display text-xl font-black tracking-[0.02em] font-stretch-70%">{NEW_TITLE}</h1>
        {signedIn ? (
          <Card>
            <div className="p-(--card-pad)">
              <NewGroupForm />
            </div>
          </Card>
        ) : (
          <>
            <p className="text-base">{NEW_SIGNED_OUT_LINE}</p>
            <form action="/auth/signin" method="post" className="pt-2">
              <input type="hidden" name="next" value="/new" />
              <Button type="submit" className="w-full md:w-auto">
                {SIGN_IN_WITH_DISCORD_LABEL}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
