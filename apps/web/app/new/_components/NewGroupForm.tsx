'use client';

import { createGroupResponseSchema, type GroupSummary } from '@customs/db/schemas';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorSentence, fieldErrors, refusalSentence } from '@/lib/groups/apiError';
import { SLUG_TAKEN } from '@/lib/groups/copy';
import {
  NEW_CREATE_LABEL,
  NEW_CREATING_LABEL,
  NEW_FAILED,
  NEW_LINK_HINT,
  NEW_LINK_LABEL,
  NEW_LINK_PREFIX,
  NEW_NAME_HINT,
  NEW_NAME_LABEL,
} from '@/lib/groups/pageCopy';

/**
 * Where a new group's creator lands (STRATEGY 3.2/3.3, a change from M13.13): its admin home, as
 * the owner, linked or not. The checklist there is the next thing they need; an unlinked creator
 * pairs from its `Set up your PC as host` card.
 */
export function createdHref(group: Pick<GroupSummary, 'slug'>): Route {
  return `/g/${encodeURIComponent(group.slug)}/admin` as Route;
}

interface Errors {
  name?: string | undefined;
  slug?: string | undefined;
  form?: string | undefined;
}

/**
 * `Start a group`'s form (M13.13): `Name`, `Link` (lowercased as typed), `Create`. It posts
 * `POST /api/groups` and prints the server's sentences under the field they belong to: a 400 names
 * its fields, a 409 is `That link is taken.` under `Link`. Nothing is checked here that the server
 * does not check: the rules are the route's, so the page cannot drift from them.
 */
export function NewGroupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const ids = {
    name: useId(),
    nameHint: useId(),
    nameError: useId(),
    slug: useId(),
    slugHint: useId(),
    slugError: useId(),
    formError: useId(),
  };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 201) {
        const parsed = createGroupResponseSchema.safeParse(body);
        if (parsed.success) {
          router.push(createdHref(parsed.data.group));
          return;
        }
        setErrors({ form: NEW_FAILED });
      } else if (response.status === 409) {
        setErrors({ slug: errorSentence(body) ?? SLUG_TAKEN });
      } else if (response.status === 400) {
        const fields = fieldErrors(body);
        if (fields.name === undefined && fields.slug === undefined) {
          setErrors({ form: errorSentence(body) ?? NEW_FAILED });
        } else {
          setErrors({ name: fields.name, slug: fields.slug });
        }
      } else {
        setErrors({ form: refusalSentence(response.status, body, NEW_FAILED) });
      }
    } catch {
      setErrors({ form: NEW_FAILED });
    }
    setPending(false);
  }

  const describedBy = (hint: string, error: string | undefined, errorId: string): string =>
    error === undefined ? hint : `${hint} ${errorId}`;

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>{NEW_NAME_LABEL}</Label>
        <p id={ids.nameHint} className="text-sm text-muted-foreground">
          {NEW_NAME_HINT}
        </p>
        <Input
          id={ids.name}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete="off"
          aria-invalid={errors.name === undefined ? undefined : true}
          aria-describedby={describedBy(ids.nameHint, errors.name, ids.nameError)}
        />
        {errors.name === undefined ? null : (
          <p id={ids.nameError} className="text-sm text-destructive">
            {errors.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.slug}>{NEW_LINK_LABEL}</Label>
        <p id={ids.slugHint} className="text-sm text-muted-foreground">
          {NEW_LINK_HINT}
        </p>
        <div className="flex items-stretch">
          <span
            aria-hidden="true"
            className="flex items-center rounded-s-control border border-e-0 border-input bg-raised px-3 font-mono text-sm text-muted-foreground"
          >
            {NEW_LINK_PREFIX}
          </span>
          <Input
            id={ids.slug}
            name="slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="rounded-s-none font-mono"
            aria-invalid={errors.slug === undefined ? undefined : true}
            aria-describedby={describedBy(ids.slugHint, errors.slug, ids.slugError)}
          />
        </div>
        {errors.slug === undefined ? null : (
          <p id={ids.slugError} className="text-sm text-destructive">
            {errors.slug}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          pending={pending}
          className="w-full md:w-auto md:self-start"
          aria-describedby={errors.form === undefined ? undefined : ids.formError}
        >
          {pending ? NEW_CREATING_LABEL : NEW_CREATE_LABEL}
        </Button>
        {errors.form === undefined ? null : (
          <p id={ids.formError} role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}
      </div>
    </form>
  );
}
