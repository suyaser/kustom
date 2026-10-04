import { describe, expect, it } from 'vitest';
import { hostAccount, hostName } from './hostName';

/** M14.50: one name for a host on the list, its confirm and the checklist; never `This PC`. */
describe('hostName', () => {
  it('a pairing is named after its account', () => {
    expect(hostName({ label: 'Kustom (paired)', account: 'Hana' })).toBe('Hana’s PC');
  });
  it('a typed name wins over the account', () => {
    expect(hostName({ label: 'Bilal’s desktop', account: 'Hana' })).toBe('Bilal’s desktop');
  });
  it('a key with no name is named after its account', () => {
    expect(hostName({ label: null, account: 'Hana' })).toBe('Hana’s PC');
    expect(hostName({ label: '   ', account: 'Hana' })).toBe('Hana’s PC');
  });
  it('falls back to Unnamed PC with no name and no account', () => {
    expect(hostName({ label: 'Kustom (paired)', account: null })).toBe('Unnamed PC');
    expect(hostName({ label: null, account: '  ' })).toBe('Unnamed PC');
  });
});

describe('hostAccount', () => {
  it('display name, else the Riot game name without its tag, else null', () => {
    expect(hostAccount({ displayName: 'Hamoodi', gameName: 'Ahmed' })).toBe('Hamoodi');
    expect(hostAccount({ displayName: ' ', gameName: 'Ahmed' })).toBe('Ahmed');
    expect(hostAccount({ displayName: null, gameName: null })).toBeNull();
  });
});
