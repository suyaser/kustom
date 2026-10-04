'use client';

import dynamic from 'next/dynamic';

/**
 * The Mode card's admin foot, code-split on the client (M14.30 acceptance 15): admins only, so its
 * chunk (the select, the AlertDialog) is fetched only where it renders, and Tonight's client JS
 * does not grow for the members and visitors who make up nearly every view. Server-rendered for
 * the admin as usual (no layout shift).
 */
export const ModeControlsLazy = dynamic(() => import('./ModeControls').then((module) => module.ModeControls));
