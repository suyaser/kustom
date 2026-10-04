/**
 * The one-line bar above the hero for a visitor whose browser remembers a group. Its own module,
 * re-exported by `copy.ts`, so `/about`'s back-bar island imports one string and not the whole
 * landing copy (which pulls in `@customs/core` for the starting rating).
 */
export const backToGroup = (groupName: string): string => `Back to ${groupName}`;
