/**
 * The words on the one-time "Kustom 2.0 patch notes" picture (`scripts/patch-notes-image.tsx`).
 * The owner posts it once in Discord after the new rating ships. Every string the picture shows
 * is here; the renderer composes no copy. To change a line, edit it here and render again.
 *
 * Plain, short lines (05-design voice): no source tags, straight apostrophes. `\u00a0` (a no-break
 * space) keeps a number with its word and stops a last word sitting alone on its line.
 */

/** Picks the section's glyph: NEW a plus, the rating a rising line, BUFFS ▲, NERFS ▼. */
export type PatchNotesKind = 'new' | 'rating' | 'buffs' | 'nerfs';

export interface PatchNotesSection {
  kind: PatchNotesKind;
  title: string;
  lines: readonly string[];
}

export interface PatchNotes {
  /** Read together as the header: `KUSTOM 2.0 PATCH NOTES`. */
  wordmark: string;
  version: string;
  notes: string;
  /** Left to right; a column stacks its sections top to bottom. */
  columns: readonly (readonly PatchNotesSection[])[];
  /** The notice along the bottom, verbatim (05-design 5.16 ruling (g) item 1). */
  footer: string;
}

export const PATCH_NOTES: PatchNotes = {
  wordmark: 'KUSTOM',
  version: '2.0',
  notes: 'PATCH NOTES',
  columns: [
    [
      {
        kind: 'new',
        title: 'NEW',
        lines: [
          'A fresh look for the whole site, with five simple tabs.',
          'Mode of the night: one game with a twist: Class wars, Region wars or Mirror match.',
          "Every game gets a recap line, and Sunday's post tells the story of the\u00a0week.",
          'Anyone can start their own group and share an invite link.',
          'Tap any points number to see why you got it.',
        ],
      },
    ],
    [
      {
        kind: 'rating',
        title: 'THE NEW RATING',
        lines: [
          'Win and you go up, lose and you go down. Upsets pay more.',
          "About 8 points a game once you've played 10, never more than\u00a020.",
          'How you played counts: MVP gains the most, ACE loses the least.',
          'A weekly Rating: everyone back to 0 every Sunday, 6\u00a0am Cairo time.',
          'Teams are balanced on the same Rating you see on the Board.',
        ],
      },
    ],
    [
      {
        kind: 'buffs',
        title: 'BUFFS',
        lines: [
          'Tonight loads about twice as fast.',
          'Discord posts redone: blue and red cards with an odds bar.',
          'Hosts: Kustom 1.0, a 3\u00a0MB app that updates itself.',
        ],
      },
      {
        kind: 'nerfs',
        title: 'NERFS',
        lines: ['Month filters and the champ-select overlay are gone.'],
      },
    ],
  ],
  footer: 'Made by Kustom for this group. Not affiliated with or endorsed by Riot Games.',
};
