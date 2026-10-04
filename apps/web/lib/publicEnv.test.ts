import { describe, expect, it } from 'vitest';
import { ServerEnvError as FromEnv, readAuthEnv } from './env';
import { readPublicSupabaseEnv, ServerEnvError } from './publicEnv';

const good = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' };

describe('readPublicSupabaseEnv (M14.44)', () => {
  it('reads the URL and the anon key', () => {
    expect(readPublicSupabaseEnv(good)).toEqual(good);
  });

  it.each([
    [{ ...good, NEXT_PUBLIC_SUPABASE_URL: undefined }, 'NEXT_PUBLIC_SUPABASE_URL'],
    [{ ...good, NEXT_PUBLIC_SUPABASE_URL: 'not a url' }, 'NEXT_PUBLIC_SUPABASE_URL'],
    [{ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  ])('refuses %o naming %s', (source, name) => {
    expect(() => readPublicSupabaseEnv(source)).toThrow(ServerEnvError);
    expect(() => readPublicSupabaseEnv(source)).toThrow(name);
  });

  it('accepts what readAuthEnv accepts, and throws the same class', () => {
    expect(readAuthEnv(good).NEXT_PUBLIC_SUPABASE_URL).toBe(
      readPublicSupabaseEnv(good).NEXT_PUBLIC_SUPABASE_URL,
    );
    expect(FromEnv).toBe(ServerEnvError);
  });
});
