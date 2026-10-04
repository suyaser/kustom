import { rememberedGroupResponseSchema } from '@customs/db/schemas';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FREE_SIGNED_IN, FREE_SIGNED_OUT } from '@/lib/landing/copy';
import type { LandingData } from '@/lib/landing/load';
import { resetSessionProbe, SESSION_PROBE_URL } from '@/lib/landing/sessionProbe';
import { SIGN_OUT_LABEL } from '@/lib/shellCopy';
import {
  AudienceSwitch,
  AudienceText,
  REMEMBERED_GROUP_URL,
  RememberedBackBar,
  readRememberedGroup,
} from './AboutIslands';
import { KustomSignIn } from './KustomSignIn';
import { LandingPage } from './LandingPage';

/**
 * The static `/about`'s islands (about-static): the back bar from `GET /api/groups/remembered`,
 * and the audience lines from the shared session probe. The prerendered first render is the
 * anonymous, no-group page; the islands only ever correct it.
 */

const SESSION = 'sb-127-auth-token';

function setCookie(name: string, value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom's cookie jar is what the probe reads.
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookie(name: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom's cookie jar is what the probe reads.
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

type Answer = (url: string) => Response | Promise<Response>;

function stubFetch(answer: Answer) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => answer(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const THURSDAY = { ok: true, group: { slug: 'thursday-flex', name: 'Thursday Flex' } };

function callsTo(fetchMock: ReturnType<typeof stubFetch>, url: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === url).length;
}

afterEach(() => {
  clearCookie(SESSION);
  vi.unstubAllGlobals();
  resetSessionProbe();
});

describe('readRememberedGroup', () => {
  it.each([
    THURSDAY,
    { ok: true, group: null },
    { ok: true },
    { ok: false, error: 'x' },
    { ok: true, group: { slug: 'Thursday', name: 'Thursday Flex' } },
    { ok: true, group: { slug: 'thursday-flex', name: '' } },
    { ok: true, group: { slug: 'new', name: 'Reserved' } },
    { ok: true, group: { slug: 42, name: 'x' } },
    null,
    'customs',
  ])('agrees with the route schema on %j', (body) => {
    const parsed = rememberedGroupResponseSchema.safeParse(body);
    const expected = parsed.success ? parsed.data.group : null;
    expect(readRememberedGroup(body)).toEqual(expected);
  });
});

describe('RememberedBackBar', () => {
  it('reserves the 44px band before it knows anything, so the bar arriving shifts nothing', () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    const { container } = render(<RememberedBackBar />);
    const band = container.firstElementChild as HTMLElement;
    expect(band).toHaveClass('min-h-11', 'border-b', 'border-transparent');
    expect(band).toHaveAttribute('data-remembered', 'none');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('asks the server once, uncached, and links back to the remembered group', async () => {
    const fetchMock = stubFetch(() => json(THURSDAY));
    const { container } = render(<RememberedBackBar />);

    const link = await screen.findByRole('link', { name: /Back to Thursday Flex/ });
    expect(link).toHaveAttribute('href', '/g/thursday-flex');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(REMEMBERED_GROUP_URL);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    // Same band, now on the card surface: one line, the name cut rather than wrapped.
    const band = container.firstElementChild as HTMLElement;
    expect(band).toHaveClass('min-h-11', 'bg-card', 'border-border');
    expect(screen.getByText('Back to Thursday Flex')).toHaveClass('truncate');
  });

  it.each([
    ['no remembered group', () => json({ ok: true, group: null })],
    ['a server error', () => json({ ok: false, error: 'x' }, 500)],
    ['a malformed body', () => json({ ok: true, group: { slug: '../admin', name: 'x' } })],
    [
      'a failed request',
      () => {
        throw new TypeError('offline');
      },
    ],
  ])('draws no bar on %s', async (_label, answer) => {
    const fetchMock = stubFetch(answer);
    const { container } = render(<RememberedBackBar />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('data-remembered', 'none');
  });
});

describe('the audience islands', () => {
  it('stay signed out, and ask nobody, without a session cookie', async () => {
    const fetchMock = stubFetch(() => json({}));
    render(
      <>
        <AudienceSwitch signedIn={<a href="/new">in</a>} signedOut={<span>out</span>} />
        <AudienceText signedIn={FREE_SIGNED_IN} signedOut={FREE_SIGNED_OUT} />
      </>,
    );
    await Promise.resolve();
    expect(screen.getByText('out')).toBeInTheDocument();
    expect(screen.getByText(FREE_SIGNED_IN)).toHaveClass('invisible');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turn for a verified session, and share one probe with the top bar', async () => {
    setCookie(SESSION, 'token');
    const fetchMock = stubFetch(() => json({ ok: true, groups: [] }));
    render(
      <>
        <KustomSignIn here="/about" />
        <AudienceSwitch signedIn={<a href="/new">in</a>} signedOut={<span>out</span>} />
        <AudienceText signedIn={FREE_SIGNED_IN} signedOut={FREE_SIGNED_OUT} />
      </>,
    );

    expect(await screen.findByRole('link', { name: 'in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SIGN_OUT_LABEL })).toBeInTheDocument();
    expect(screen.getByText(FREE_SIGNED_OUT)).toHaveClass('invisible');
    expect(screen.getByText(FREE_SIGNED_OUT)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(FREE_SIGNED_IN)).not.toHaveClass('invisible');
    expect(callsTo(fetchMock, SESSION_PROBE_URL)).toBe(1);
  });

  it('read a refused session as signed out', async () => {
    setCookie(SESSION, 'stale');
    const fetchMock = stubFetch(() => json({ ok: false, error: 'no session' }, 401));
    render(<AudienceText signedIn={FREE_SIGNED_IN} signedOut={FREE_SIGNED_OUT} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.getByText(FREE_SIGNED_IN)).toHaveClass('invisible');
  });
});

describe('the landing page in island mode (the static /about)', () => {
  const DATA: LandingData = {
    demo: { id: 'g1', slug: 'customs', name: 'Customs Night' },
    demoGames: 0,
    hero: { kind: 'example' },
    calibration: null,
    counters: null,
  };

  it('prerenders the anonymous page: two sign-in forms, the signed-out Free line, an empty band', () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    render(<LandingPage data={DATA} islands />);
    const buttons = screen.getAllByRole('button', { name: 'Create your group' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const form = button.closest('form') as HTMLElement;
      expect(form).toHaveAttribute('action', '/auth/signin');
      expect(within(form).getByDisplayValue('/new')).toHaveAttribute('name', 'next');
    }
    expect(screen.getByText(FREE_SIGNED_OUT)).not.toHaveClass('invisible');
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull();
  });

  it('a signed-in visitor with a remembered group gets the bar and links to /new', async () => {
    setCookie(SESSION, 'token');
    stubFetch((url) => (url === REMEMBERED_GROUP_URL ? json(THURSDAY) : json({ ok: true, groups: [] })));
    render(<LandingPage data={DATA} islands />);

    expect(await screen.findByRole('link', { name: /Back to Thursday Flex/ })).toHaveAttribute(
      'href',
      '/g/thursday-flex',
    );
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Create your group' })).toHaveLength(2));
    for (const link of screen.getAllByRole('link', { name: 'Create your group' })) {
      expect(link).toHaveAttribute('href', '/new');
    }
    expect(screen.queryByRole('button', { name: 'Create your group' })).toBeNull();
    expect(screen.getByText(FREE_SIGNED_IN)).not.toHaveClass('invisible');
  });
});
