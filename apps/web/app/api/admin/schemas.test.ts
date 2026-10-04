import { describe, expect, it } from 'vitest';
import { internalPathSchema } from '@/lib/admin/formValues';
import { discordConfigRequestSchema } from './discord-config/schema';
import { fearlessResetRequestSchema } from './fearless/reset/schema';
import { adminTokensRequestSchema } from './tokens/schema';

/**
 * The request schemas, from both sides: what a browser form sends (strings, empties) and what
 * a JSON caller sends (nulls, booleans). Both have to land on the same value.
 */

const PLAYER = '11111111-1111-4111-8111-111111111111';
/** Every admin body names its group (M13.4). */
const GROUP = '00000000-0000-4000-8000-00000000000a';

describe('adminTokensRequestSchema', () => {
  it('still parses an old mint body, keeping only the action and group, so the handler can answer 410 (M17.12)', () => {
    expect(
      adminTokensRequestSchema.parse({ groupId: GROUP, action: 'mint', playerId: PLAYER, label: '' }),
    ).toEqual({ action: 'mint', groupId: GROUP });
    expect(adminTokensRequestSchema.parse({ groupId: GROUP, action: 'mint' })).toEqual({
      action: 'mint',
      groupId: GROUP,
    });
  });

  it('accepts a revoke by token id', () => {
    expect(
      adminTokensRequestSchema.safeParse({ groupId: GROUP, action: 'revoke', tokenId: PLAYER }).success,
    ).toBe(true);
  });

  it('rejects a revoke without a token id', () => {
    expect(adminTokensRequestSchema.safeParse({ groupId: GROUP, action: 'revoke' }).success).toBe(false);
  });
});

describe('discordConfigRequestSchema', () => {
  const base = {
    groupId: GROUP,
    guildId: '123',
    webhookUrl: '',
    resultsChannelId: '',
    lobbyVoiceChannelId: '',
    blueVoiceChannelId: '',
    redVoiceChannelId: '',
  };

  it('treats an empty webhook as "leave it alone" and empty ids as null', () => {
    expect(discordConfigRequestSchema.parse(base)).toEqual({
      groupId: GROUP,
      guildId: '123',
      webhookUrl: null,
      resultsChannelId: null,
      lobbyVoiceChannelId: null,
      blueVoiceChannelId: null,
      redVoiceChannelId: null,
    });
  });

  it('accepts a real Discord webhook URL', () => {
    const parsed = discordConfigRequestSchema.parse({
      ...base,
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    expect(parsed.webhookUrl).toBe('https://discord.com/api/webhooks/123/abc');
  });

  it('rejects a webhook URL that is not a Discord webhook', () => {
    const result = discordConfigRequestSchema.safeParse({
      ...base,
      webhookUrl: 'https://evil.example/api/webhooks/123/abc',
    });
    expect(result.success).toBe(false);
  });

  it('reads a missing, empty, null or "unknown" guild id as absent, and keeps an explicit one', () => {
    const { guildId: _omit, ...withoutGuild } = base;
    for (const body of [
      withoutGuild,
      { ...base, guildId: '  ' },
      { ...base, guildId: 'unknown' },
      { ...base, guildId: null },
    ]) {
      expect(discordConfigRequestSchema.parse(body).guildId).toBeUndefined();
    }
    expect(discordConfigRequestSchema.parse({ ...base, guildId: ' 123 ' }).guildId).toBe('123');
  });

  it('reads the clear checkbox', () => {
    expect(discordConfigRequestSchema.parse({ ...base, clearWebhook: 'true' }).clearWebhook).toBe(true);
  });
});

describe('internalPathSchema', () => {
  it('accepts a path on this site', () => {
    expect(internalPathSchema.safeParse('/admin/players').success).toBe(true);
  });

  it('rejects anything that could leave the site', () => {
    for (const value of ['//evil.example', 'https://evil.example', '/\\evil.example', 'admin']) {
      expect(internalPathSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('fearlessResetRequestSchema', () => {
  it('accepts an empty body and a path on this site', () => {
    expect(fearlessResetRequestSchema.parse({ groupId: GROUP })).toEqual({ groupId: GROUP });
    expect(fearlessResetRequestSchema.parse({ groupId: GROUP, redirectTo: '/admin' })).toEqual({
      groupId: GROUP,
      redirectTo: '/admin',
    });
  });

  it('refuses a body that names no group, or not a group id (M13.4)', () => {
    expect(fearlessResetRequestSchema.safeParse({}).success).toBe(false);
    expect(fearlessResetRequestSchema.safeParse({ groupId: 'customs' }).success).toBe(false);
    expect(adminTokensRequestSchema.safeParse({ action: 'revoke', tokenId: PLAYER }).success).toBe(false);
  });
});
