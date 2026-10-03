import { describe, expect, it } from 'vitest';
import { type OverlayGroup, overlayGroupFor } from './groups';

const A: OverlayGroup = {
  id: 'a0000000-0000-4000-8000-000000000001',
  slug: 'customs',
  name: 'Customs Night',
};
const B: OverlayGroup = { id: 'b0000000-0000-4000-8000-000000000002', slug: 'other', name: 'Other' };

describe('overlayGroupFor (M13.3)', () => {
  it('answers a requested group only when the PUUID is a member of it', () => {
    expect(overlayGroupFor([A, B], B.id)).toBe(B.id);
    expect(overlayGroupFor([A], B.id)).toBeNull();
    expect(overlayGroupFor([], A.id)).toBeNull();
  });

  it('with no group, answers the only group, and nothing when there are several', () => {
    expect(overlayGroupFor([A], null)).toBe(A.id);
    expect(overlayGroupFor([A, B], null)).toBeNull();
    expect(overlayGroupFor([], null)).toBeNull();
  });
});
