import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'build/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
