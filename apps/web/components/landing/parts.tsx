import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NEW_GROUP_PATH } from '@/lib/groups/landing';
import { CREATE_GROUP } from '@/lib/landing/copy';
import type { LandingAudience } from '@/lib/landing/decide';
import { cn } from '@/lib/utils';

/**
 * Small shared pieces of Kustom's own pages (M14.24). Server components, no JavaScript: every
 * control is a link, a `<form>` or a `<details>`.
 */

/** One page section: an h2 and its body, 32px apart on phones, 48 from 1024 (05-design 2.5). */
export function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('flex flex-col gap-4', className)}>
      <h2 id={headingId} className="text-lg font-bold text-balance">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The page column: the gutter, a readable measure, the section rhythm. */
export function PageColumn({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-7xl flex-col gap-8 px-(--gutter) py-6 lg:gap-12 lg:py-10',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * `Create your group`. Signed in, a link to `/new`. Signed out, a sign-in form that comes back to
 * `/new` (STRATEGY §2.3: "Signed-out visitors go through Discord sign-in and come back to `/new`"),
 * which works with JavaScript off. A plain `<a>`, not `next/link`: `/new` is M14.21's page, built
 * in another lane, and typed routes would refuse a link to a page this branch does not have.
 */
/**
 * The button's own `shrink-0` keeps it one line; at 200% text on a 375 phone that pushed the page
 * to 493px (M14.42, quality A9). Here it may shrink to its column and wrap instead.
 */
const WRAPS = 'min-w-0 max-w-full shrink';

export function CreateGroupButton({
  audience,
  className,
}: {
  audience: LandingAudience;
  className?: string | undefined;
}) {
  if (audience === 'signed-in') {
    return (
      <Button asChild className={cn(WRAPS, className)}>
        <a href={NEW_GROUP_PATH}>{CREATE_GROUP}</a>
      </Button>
    );
  }
  return (
    <form action="/auth/signin" method="post" className={cn('flex min-w-0 max-w-full', className)}>
      <input type="hidden" name="next" value={NEW_GROUP_PATH} />
      <Button type="submit" className={cn(WRAPS, 'w-full cursor-pointer')}>
        {CREATE_GROUP}
      </Button>
    </form>
  );
}

/** A bulleted fact with its term in bold: the companion's reads / can do / never touches. */
export function TermList({ items }: { items: readonly { term: string; body: string }[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.term} className="flex flex-col gap-0.5">
          <dt className="font-bold">{item.term}</dt>
          <dd className="text-pretty text-muted-foreground">{item.body}</dd>
        </div>
      ))}
    </dl>
  );
}
