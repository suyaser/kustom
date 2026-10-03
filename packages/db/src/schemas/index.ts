/**
 * Every boundary in this project is validated with zod, and the API, the companion and the
 * bot all import the schema from here so there is exactly one definition per payload.
 */

export * from './common';
export * from './companion';
export * from './companionResponses';
export * from './groups';
export * from './invites';
export * from './me';
export * from './mystery';
export * from './windowPosts';
