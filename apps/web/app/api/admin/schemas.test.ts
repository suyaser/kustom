import { describe, expect, it } from 'vitest';
import { internalPathSchema } from '@/lib/admin/formValues';
import { discordConfigRequestSchema } from './discord-config/schema';
import { fearlessResetRequestSchema } from './fearless/reset/schema';
import { adminPlayersRequestSchema } from './players/schema';
import { adminTokensRequestSchema } from './tokens/schema';

/**
 * The request schemas, from both sides: what a browser form sends (strings, empties) and what
 * a JSON caller sends (nulls, booleans). Both have to land on the same value.
 */

const PLAYER = '11111111-1111-4111-8111-111111111111';

describe('adminPlayersRequestSchema', () => {
  it('still parses a stale tab\u2019s role post, so the route can refuse it in words (M5.17)', () => {
    // The action is retired and the handler answers 410. The variant stays parseable because a
    // browser that has had the page open since before the deploy is the one caller left, and
    // `that form was not valid` would tell them nothing true.
    const parsed = adminPlayersRequestSchema.parse({
      action: 'set-roles',
      playerId: PLAYER,
      mainRole: '',
      secondaryRole: 'none',
    });

    expect(parsed).toMatchObject({ action: 'set-roles', playerId: PLAYER });
  });

  it('rejects a player id that is not a uuid', () => {
    const result = adminPlayersRequestSchema.safeParse({
      action: 'set-name',
      playerId: 'puuid-hana',
      displayName: 'Hana',
    });

    expect(result.success).toBe(false);
  });

  it('trims a Discord id and turns an empty one into an unlink', () => {
    expect(
      adminPlayersRequestSchema.parse({
        action: 'set-discord',
        playerId: PLAYER,
        discordId: '  204255221925378048  ',
      }),
    ).toMatchObject({ discordId: '204255221925378048' });

    expect(
      adminPlayersRequestSchema.parse({ action: 'set-discord', playerId: PLAYER, discordId: '' }),
    ).toMatchObject({ discordId: null });
  });

  it('reads the admin flag as a target state, from a string or a boolean', () => {
    expect(
      adminPlayersRequestSchema.parse({ action: 'set-admin', playerId: PLAYER, isAdmin: 'false' }),
    ).toMatchObject({ isAdmin: false });
    expect(
      adminPlayersRequestSchema.parse({ action: 'set-admin', playerId: PLAYER, isAdmin: true }),
    ).toMatchObject({ isAdmin: true });
  });

  it('takes a display name and reads an empty field as "back on automatic"', () => {
    expect(
      adminPlayersRequestSchema.parse({ action: 'set-name', playerId: PLAYER, displayName: '  Hamoodi ' }),
    ).toEqual({ action: 'set-name', playerId: PLAYER, displayName: 'Hamoodi' });

    // The form posts "" for a cleared field; a JSON caller sends null. Both mean the same thing.
    for (const displayName of ['', '   ', null]) {
      expect(
        adminPlayersRequestSchema.parse({ action: 'set-name', playerId: PLAYER, displayName }),
      ).toMatchObject({ displayName: null });
    }
  });

  it('rejects an unknown action', () => {
    expect(adminPlayersRequestSchema.safeParse({ action: 'delete', playerId: PLAYER }).success).toBe(false);
  });
});

describe('adminTokensRequestSchema', () => {
  it('accepts a mint with no label', () => {
    expect(adminTokensRequestSchema.parse({ action: 'mint', playerId: PLAYER, label: '' })).toMatchObject({
      action: 'mint',
      label: null,
    });
  });

  it('accepts a revoke by token id', () => {
    expect(adminTokensRequestSchema.safeParse({ action: 'revoke', tokenId: PLAYER }).success).toBe(true);
  });

  it('rejects a revoke without a token id', () => {
    expect(adminTokensRequestSchema.safeParse({ action: 'revoke' }).success).toBe(false);
  });
});

describe('discordConfigRequestSchema', () => {
  const base = {
    guildId: '123',
    webhookUrl: '',
    resultsChannelId: '',
    lobbyVoiceChannelId: '',
    blueVoiceChannelId: '',
    redVoiceChannelId: '',
  };

  it('treats an empty webhook as "leave it alone" and empty ids as null', () => {
    expect(discordConfigRequestSchema.parse(base)).toEqual({
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

  it('rejects an empty guild id', () => {
    expect(discordConfigRequestSchema.safeParse({ ...base, guildId: '  ' }).success).toBe(false);
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
    expect(fearlessResetRequestSchema.parse({})).toEqual({});
    expect(fearlessResetRequestSchema.parse({ redirectTo: '/admin' })).toEqual({
      redirectTo: '/admin',
    });
  });
});
