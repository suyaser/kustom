import { describe, expect, it } from 'vitest';
import { refusalSentence } from './apiError';
import { INVITE_DEAD, JOIN_NOT_LINKED, PAIRING_NOT_CREATOR, SLUG_TAKEN } from './copy';
import { NOT_ALLOWED_HERE, SESSION_EXPIRED } from './pageCopy';

/** No developer text from the session gate reaches `/new` or `/join` (lead, 2026-10-03). */
describe('refusalSentence', () => {
  const FALLBACK = 'Try again.';

  it('a 401 is always "sign in again"', () => {
    expect(refusalSentence(401, { ok: false, error: 'sign in required' }, FALLBACK)).toBe(SESSION_EXPIRED);
    expect(refusalSentence(401, null, FALLBACK)).toBe(SESSION_EXPIRED);
  });

  it("a 403 keeps the routes' own sentences for people and hides the gate's", () => {
    expect(refusalSentence(403, { ok: false, error: 'this session has no Discord identity' }, FALLBACK)).toBe(
      NOT_ALLOWED_HERE,
    );
    expect(refusalSentence(403, { ok: false, error: JOIN_NOT_LINKED }, FALLBACK)).toBe(JOIN_NOT_LINKED);
    expect(refusalSentence(403, { ok: false, error: PAIRING_NOT_CREATOR }, FALLBACK)).toBe(
      PAIRING_NOT_CREATOR,
    );
  });

  it("other 4xx are product's sentences; a 5xx is the page's fallback", () => {
    expect(refusalSentence(404, { ok: false, error: INVITE_DEAD }, FALLBACK)).toBe(INVITE_DEAD);
    expect(refusalSentence(409, { ok: false, error: SLUG_TAKEN }, FALLBACK)).toBe(SLUG_TAKEN);
    expect(refusalSentence(500, { ok: false, error: 'internal error' }, FALLBACK)).toBe(FALLBACK);
    expect(refusalSentence(404, null, FALLBACK)).toBe(FALLBACK);
  });
});
