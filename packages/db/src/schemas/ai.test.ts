import { describe, expect, it } from 'vitest';
import { aiLineRowSchema, ORIGINAL_GROUP_ID } from './index';

const row = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  group_id: ORIGINAL_GROUP_ID,
  kind: 'week',
  subject: '2026-09-27',
  status: 'pending',
  text: null,
  token_map: { P1: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d' },
  fact_hash: 'a'.repeat(64),
  model: 'deepseek-v4-pro',
  prompt_version: 'v1',
  attempts: 0,
  reject_reason: null,
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  created_at: '2026-10-04T18:43:21.000Z',
  updated_at: '2026-10-04T18:43:21.000Z',
  published_at: null,
};

describe('aiLineRowSchema', () => {
  it('reads a row of the original group, whose fixed id is not an RFC uuid (2026-10-04)', () => {
    expect(ORIGINAL_GROUP_ID).toBe('00000000-0000-0000-0000-000000000001');
    expect(aiLineRowSchema.safeParse(row).success).toBe(true);
  });

  it('still refuses a group id that is not a uuid at all', () => {
    expect(aiLineRowSchema.safeParse({ ...row, group_id: 'customs' }).success).toBe(false);
  });
});
