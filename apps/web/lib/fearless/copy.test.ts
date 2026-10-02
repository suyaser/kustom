import { describe, expect, it } from 'vitest';
import {
  FEARLESS_BANNED_LABEL,
  FEARLESS_CARD_SENTENCE,
  FEARLESS_OPEN,
  FEARLESS_OTHER,
  FEARLESS_RESET_DESCRIPTION,
  FEARLESS_RESET_FAILED,
  FEARLESS_RESET_NOTICE,
  FEARLESS_RESET_POSTED,
  FEARLESS_RESET_SKIPPED,
  FEARLESS_SEARCH,
  FEARLESS_SEARCH_EMPTY,
  FEARLESS_SENTENCE,
  FEARLESS_TITLE,
  fearlessAvailable,
  fearlessBanned,
  fearlessBannedCount,
  fearlessCount,
  fearlessDescription,
  fearlessLaneOpen,
  fearlessLaneTitle,
} from './copy';

describe('fearless copy', () => {
  it('is the sentence the Discord post prints, and the tonight card its own', () => {
    expect(FEARLESS_TITLE).toBe('Fearless');
    expect(FEARLESS_SENTENCE).toBe('Ban these next game.');
    expect(fearlessDescription(10)).toBe('Ban these next game. 10 champions.');
    expect(fearlessCount(1)).toBe('1 champion.');
    expect(fearlessCount(0)).toBe('0 champions.');
    expect(fearlessLaneTitle('jungle')).toBe('jungle');
    expect(fearlessLaneTitle(null)).toBe(FEARLESS_OTHER);
    expect(fearlessBanned('Ahri')).toBe('Ahri is on the ban list.');
    expect(FEARLESS_OPEN).toBe('still open');
    expect(FEARLESS_BANNED_LABEL).toBe('banned');
    expect(fearlessBannedCount(79)).toBe('79 banned.');
    expect(fearlessLaneOpen(24)).toBe('24 open');
    expect(fearlessLaneOpen(0)).toBe('none open');
    // The card leads with the open champions, so it does not say "ban these" over them.
    expect(FEARLESS_CARD_SENTENCE).not.toBe(FEARLESS_SENTENCE);
    expect(fearlessAvailable('Garen')).toBe('Garen is still available.');
    expect(FEARLESS_SEARCH).toBe('Find a champion');
    expect(FEARLESS_SEARCH_EMPTY).toBe('No champion matches.');
  });

  it('names the reset outcomes the admin route greps for', () => {
    expect(FEARLESS_RESET_NOTICE).toBe('Fearless pool cleared.');
    expect(FEARLESS_RESET_POSTED).toContain('Posted to Discord.');
    expect(FEARLESS_RESET_SKIPPED).toContain('No webhook is configured');
    expect(FEARLESS_RESET_FAILED).toContain('the pool is empty');
    expect(FEARLESS_RESET_DESCRIPTION).toBe('Pool cleared. Ban list is empty.');
  });

  it('is floodlit: no emoji, no GG, no auto-ban promise', () => {
    const all = [
      FEARLESS_TITLE,
      FEARLESS_SENTENCE,
      FEARLESS_SEARCH,
      FEARLESS_SEARCH_EMPTY,
      FEARLESS_OPEN,
      FEARLESS_OTHER,
      FEARLESS_RESET_DESCRIPTION,
      FEARLESS_RESET_NOTICE,
      FEARLESS_RESET_POSTED,
      fearlessBanned('Ahri'),
      fearlessAvailable('Garen'),
      fearlessDescription(10),
    ].join(' ');
    expect(/^[ -~]+$/u.test(all)).toBe(true);
    expect(all.toLowerCase()).not.toContain('auto');
    expect(all.toLowerCase()).not.toContain('gg');
  });
});
