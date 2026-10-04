import { describe, expect, it } from 'vitest';
import { aiProviderOf, PREFERRED_AI_PROVIDER, readAiEnv } from './env';

/** The AI provider switch (the user's 2026-10-04 move to DeepSeek): which key, which provider. */

const BOTH = { DEEPSEEK_API_KEY: 'sk-ds', ANTHROPIC_API_KEY: 'sk-ant' };

describe('readAiEnv', () => {
  it('is null with no key at all, or only blank keys', () => {
    expect(readAiEnv({})).toBeNull();
    expect(readAiEnv({ DEEPSEEK_API_KEY: ' ', ANTHROPIC_API_KEY: '' })).toBeNull();
  });

  it('an explicit AI_PROVIDER uses only its own key', () => {
    expect(readAiEnv({ ...BOTH, AI_PROVIDER: 'deepseek' })).toEqual({
      provider: 'deepseek',
      apiKey: 'sk-ds',
    });
    expect(readAiEnv({ ...BOTH, AI_PROVIDER: 'anthropic' })).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-ant',
    });
    expect(readAiEnv({ ANTHROPIC_API_KEY: 'sk-ant', AI_PROVIDER: 'deepseek' })).toBeNull();
    expect(readAiEnv({ DEEPSEEK_API_KEY: 'sk-ds', AI_PROVIDER: 'anthropic' })).toBeNull();
  });

  it('a mistyped AI_PROVIDER turns AI off rather than guessing', () => {
    expect(readAiEnv({ ...BOTH, AI_PROVIDER: 'claude' })).toBeNull();
  });

  it('unset, it takes the preferred provider when both keys are set, else whichever is set', () => {
    expect(readAiEnv(BOTH)?.provider).toBe(PREFERRED_AI_PROVIDER);
    expect(readAiEnv({ ...BOTH, AI_PROVIDER: '  ' })?.provider).toBe(PREFERRED_AI_PROVIDER);
    expect(readAiEnv({ DEEPSEEK_API_KEY: ' sk-ds ' })).toEqual({ provider: 'deepseek', apiKey: 'sk-ds' });
    expect(readAiEnv({ ANTHROPIC_API_KEY: 'sk-ant' })).toEqual({ provider: 'anthropic', apiKey: 'sk-ant' });
  });
});

describe('aiProviderOf', () => {
  it('follows readAiEnv, then an explicit AI_PROVIDER, then the preference', () => {
    expect(aiProviderOf({ DEEPSEEK_API_KEY: 'sk-ds' })).toBe('deepseek');
    expect(aiProviderOf({ AI_PROVIDER: 'deepseek' })).toBe('deepseek');
    expect(aiProviderOf({ AI_PROVIDER: 'nonsense' })).toBe(PREFERRED_AI_PROVIDER);
    expect(aiProviderOf({})).toBe(PREFERRED_AI_PROVIDER);
  });
});
