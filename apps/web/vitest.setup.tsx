import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetModeStoreForTests } from '@/lib/mode/clientStore';
import { resetControlsForTests } from '@/lib/mode/controlsStore';

/**
 * Setup for the `dom` project only (`vitest.config.ts`): jest-dom's matchers and one unmount
 * between tests, so a component that subscribes to something cannot leak into the next file.
 * The client mode store (M19.13) is module state that every Mode card and control shares, so it
 * is emptied between tests too.
 *
 * The file is `.tsx` because React's JSX runtime has to be the one the components are compiled
 * against; nothing else belongs in here.
 */
afterEach(() => {
  cleanup();
  resetModeStoreForTests();
  resetControlsForTests();
});
