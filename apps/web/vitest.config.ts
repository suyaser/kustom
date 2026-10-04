import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * `server-only` (M14.44) throws unless the bundler resolves it under the `react-server`
 * condition, which only Next does. Tests import server modules straight, so they get the package's
 * own empty file -- the same thing a server component gets.
 */
const alias = {
  '@': fileURLToPath(new URL('.', import.meta.url)),
  'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
};

export default defineConfig({
  test: {
    /*
     * One test file at a time.
     *
     * The integration files (`*.integration.test.ts`) all talk to the *same* Supabase local
     * stack, and some of the state they touch is shared rather than namespaceable: several
     * files write into the original group (its one `discord_config`, its daily challenges, its
     * board), and a count read in one file sees rows another file has not cleaned up yet.
     *
     * The whole suite is about a second, so serialising every file costs nothing and removes a
     * class of flake that only shows up on some runs.
     *
     * **It has to be set on every project, not only here** (2026-09-11, M5.7). With `projects`
     * defined, this root-level value does not reach them: `vitest run lib/ingest lib/board`
     * ran the rebuild's file beside `roles.integration.test.ts`, whose games the rebuild then
     * folded -- twenty players and nine games it had never heard of (the rebuild has had a
     * group of its own since M14.14). Adding one file was enough to
     * change the scheduling and make it show. `--no-file-parallelism` on the command line is
     * the same switch; nobody should have to remember it.
     */
    fileParallelism: false,

    /*
     * Two projects, because component tests need a DOM and nothing else does (M3.4).
     *
     * `node` is what has always run here: route handlers, the ingest, the embeds, the
     * integration files against the local stack. It keeps the node environment, because a
     * jsdom global `fetch`/`Response` under a route handler test would be testing a different
     * runtime than Vercel runs.
     *
     * `dom` is the `.test.tsx` files only, under jsdom, for the tonight page's components. The split
     * is by extension rather than by directory so a `.tsx` test cannot end up in the wrong
     * environment by living in the wrong folder.
     */
    projects: [
      {
        resolve: { alias },
        // The integration file renders the page's components to a string to check the first
        // paint, so the node project needs the same JSX transform the dom one does.
        oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
        test: {
          name: 'node',
          environment: 'node',
          include: ['app/**/*.test.ts', 'lib/**/*.test.ts', 'components/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        resolve: { alias },
        /*
         * The app's `tsconfig.json` sets `jsx: preserve`, because Next compiles the JSX. A
         * test file has no Next in front of it, so the test runner has to do that transform
         * itself: without this the `.tsx` files reach the bundler as JSX and fail to parse.
         */
        oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx', 'lib/**/*.test.tsx', 'components/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.tsx'],
          fileParallelism: false,
        },
      },
    ],
  },
});
