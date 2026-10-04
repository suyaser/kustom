import { rememberedGroupResponseSchema } from '@customs/db/schemas';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { rememberedGroupRoute } from './handler';

const THURSDAY: PageGroup = { id: 'g2', slug: 'thursday-flex', name: 'Thursday Flex' };
const URL = 'http://localhost/api/groups/remembered';

function request(cookie?: string): NextRequest {
  return new NextRequest(URL, cookie === undefined ? {} : { headers: { cookie } });
}

async function answer(route: ReturnType<typeof rememberedGroupRoute>, cookie?: string) {
  const response = await route(request(cookie));
  const body = rememberedGroupResponseSchema.parse(await response.json());
  return { response, body };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/groups/remembered', () => {
  it('answers the group the kustom_group cookie names, public fields only', async () => {
    const groupBySlug = vi.fn(async (slug: string) => (slug === THURSDAY.slug ? THURSDAY : null));
    const { response, body } = await answer(
      rememberedGroupRoute({ groupBySlug }),
      'sb-x-auth-token=t; kustom_group=thursday-flex',
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, group: { slug: 'thursday-flex', name: 'Thursday Flex' } });
    expect(groupBySlug).toHaveBeenCalledWith('thursday-flex');
  });

  it('is never cached by anything shared', async () => {
    const { response } = await answer(
      rememberedGroupRoute({ groupBySlug: async () => THURSDAY }),
      'kustom_group=x',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const empty = await rememberedGroupRoute({ groupBySlug: async () => THURSDAY })(request());
    expect(empty.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers null without a cookie, and reads nothing', async () => {
    const groupBySlug = vi.fn(async () => THURSDAY);
    const { response, body } = await answer(rememberedGroupRoute({ groupBySlug }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, group: null });
    expect(groupBySlug).not.toHaveBeenCalled();
  });

  it('answers null for a slug groups_public does not know', async () => {
    const { body } = await answer(
      rememberedGroupRoute({ groupBySlug: async () => null }),
      'kustom_group=gone',
    );
    expect(body).toEqual({ ok: true, group: null });
  });

  it('answers null, not a 500, when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { response, body } = await answer(
      rememberedGroupRoute({
        groupBySlug: async () => {
          throw new Error('group lookup failed: timeout');
        },
      }),
      'kustom_group=thursday-flex',
    );
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, group: null });
  });
});
