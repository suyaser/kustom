import { describe, expect, it } from 'vitest';
import { game4Identity } from '../testing/discordGame4';
import { RATINGS_RESET_TITLE, ratingsResetDescription, ratingsResetEmbed } from './ratingsReset';

/** The reset post (M14.18): STRATEGY §3.6's sentence, the only record of the old board. */
describe('ratingsResetEmbed', () => {
  it('names the top three before the reset, best first', () => {
    const payload = ratingsResetEmbed({
      identity: game4Identity('https://kustom.example'),
      topThree: ['Zoe', 'Ali', null],
      url: 'https://kustom.example/g/customs/leaderboard?window=all-time',
    });
    expect(payload).toMatchInlineSnapshot(`
      {
        "avatar_url": "https://kustom.example/og/kustom/avatar?v=2",
        "embeds": [
          {
            "author": {
              "name": "Customs Night",
              "url": "https://kustom.example/g/customs",
            },
            "color": 16764774,
            "description": "Ratings were reset. Everyone starts at 1200 again. Top 3 before the reset: Zoe, Ali and Someone.",
            "title": "Ratings reset",
            "url": "https://kustom.example/g/customs/leaderboard?window=all-time",
          },
        ],
        "username": "Kustom",
      }
    `);
  });

  it('leaves the top-3 sentence off when nobody was ranked, and never prints more than three', () => {
    expect(ratingsResetDescription([])).toBe('Ratings were reset. Everyone starts at 1200 again.');
    const four = ratingsResetEmbed({ identity: game4Identity(null), topThree: ['A', 'B', 'C', 'D'] });
    expect(four.embeds[0]?.description).toBe(
      'Ratings were reset. Everyone starts at 1200 again. Top 3 before the reset: A, B and C.',
    );
    expect(four.embeds[0]?.title).toBe(RATINGS_RESET_TITLE);
    expect(four.embeds[0]?.url).toBeUndefined();
  });
});
