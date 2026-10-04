import { GROUP_NAME_RULE, GROUP_SLUG_RULE } from '@customs/db/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEW_FAILED } from '@/lib/groups/pageCopy';
import { groupNavItems } from '@/lib/nav';
import { NewGroupForm } from './NewGroupForm';
import { NewGroupView } from './NewGroupView';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

/** `/new` (M13.13 acceptance 1, 2 and 4; M14.21 acceptance 6). Role and text queries only. */

const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fill(name: string, slug: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Link'), { target: { value: slug } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('Start a group', () => {
  it('signed out: the heading and a Discord sign-in that comes back to /new', () => {
    render(<NewGroupView signedIn={false} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start a group');
    const form = screen.getByRole('button', { name: 'Sign in with Discord' }).closest('form');
    expect(form).toHaveAttribute('action', '/auth/signin');
    expect(screen.getByDisplayValue('/new')).toHaveAttribute('name', 'next');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('signed in: two labelled fields with their hints, and Create', () => {
    render(<NewGroupView signedIn />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start a group');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('What your friends call it.');
    expect(screen.getByLabelText('Link')).toHaveAccessibleDescription(
      "Letters, numbers and dashes. You can't change it later.",
    );
    expect(screen.getByText('…/g/')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('lowercases the link as it is typed', () => {
    render(<NewGroupForm />);
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'Friday-Five' } });
    expect(screen.getByLabelText('Link')).toHaveValue('friday-five');
  });

  it('lands the creator on the admin home, which has the checklist', async () => {
    const fetchMock = answer(201, { ok: true, group: GROUP, role: null });
    render(<NewGroupForm />);
    fill('Friday Five', 'friday-five');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/g/friday-five/admin'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/groups',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Friday Five', slug: 'friday-five' }),
      }),
    );
  });

  it('a taken link: "That link is taken." under Link', async () => {
    answer(409, { ok: false, error: 'That link is taken.' });
    render(<NewGroupForm />);
    fill('Friday Five', 'customs');
    const link = screen.getByLabelText('Link');
    await waitFor(() => expect(link).toHaveAttribute('aria-invalid', 'true'));
    expect(link).toHaveAccessibleDescription(
      "Letters, numbers and dashes. You can't change it later. That link is taken.",
    );
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(push).not.toHaveBeenCalled();
  });

  it("the server's sentences go under the field each one belongs to", async () => {
    answer(400, {
      ok: false,
      error: GROUP_NAME_RULE,
      issues: [
        { path: 'name', message: GROUP_NAME_RULE },
        { path: 'slug', message: GROUP_SLUG_RULE },
      ],
    });
    render(<NewGroupForm />);
    fill('', 'a');
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
      `What your friends call it. ${GROUP_NAME_RULE}`,
    );
    expect(screen.getByLabelText('Link')).toHaveAccessibleDescription(
      `Letters, numbers and dashes. You can't change it later. ${GROUP_SLUG_RULE}`,
    );
  });

  it('anything else: one sentence under the button', async () => {
    answer(500, { ok: false, error: 'internal error' });
    render(<NewGroupForm />);
    fill('Friday Five', 'friday-five');
    expect(await screen.findByRole('alert')).toHaveTextContent(NEW_FAILED);
  });
});

describe('neither page is in a group nav', () => {
  it('no tab for /new or /join, admin or not', () => {
    for (const isAdmin of [false, true]) {
      for (const item of groupNavItems(GROUP, { isAdmin })) {
        expect(item.href).not.toMatch(/^\/(new|join)(\/|$)/);
      }
    }
  });
});
