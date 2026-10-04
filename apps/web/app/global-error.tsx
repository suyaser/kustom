'use client';

import { useEffect } from 'react';
import {
  BACK_TO_KUSTOM_LABEL,
  ERROR_TITLE,
  errorReference,
  RIOT_NOTICE,
  TRY_AGAIN_LABEL,
} from '@/lib/shellCopy';

/**
 * The root layout itself failed (M14.7, 05-design.md 5.8). This replaces it, so it renders its own
 * <html> and cannot count on the app's CSS or fonts (they may be what failed): the Night tokens are
 * inlined from 7.3 and the text face is the fallback stack only. The page stays usable without
 * JavaScript: `Back to Kustom` is a plain link.
 */
const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100svh; background: #05070C; color: #F4F7FC;
  font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { background: #0C121A; border-bottom: 1px solid #2A3344; padding: 0 16px; min-height: 60px;
  display: flex; align-items: center; font-weight: 900; letter-spacing: .02em; }
main { max-width: 48rem; margin: 0 auto; padding: 40px 16px; display: flex; flex-direction: column; gap: 16px; }
h1 { font-size: 2rem; line-height: 1.05; margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 12px; }
a, button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  padding: 8px 16px; border-radius: 6px; font: inherit; font-weight: 700; cursor: pointer; }
button { background: #FFCF66; color: #10141B; border: 0; }
a { color: #F4F7FC; background: #141B28; border: 1px solid #66738A; text-decoration: none; }
:focus-visible { outline: 2px solid #F4F7FC; outline-offset: 2px; }
footer { max-width: 48rem; margin: 0 auto; padding: 16px; border-top: 1px solid #2A3344; font-size: 15px; color: #8B98AD; }
p { margin: 0; font: 13px/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #8B98AD; }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Kustom</title>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet, no input */}
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>KUSTOM</header>
        <main>
          <h1>{ERROR_TITLE}</h1>
          <div className="row">
            <button type="button" onClick={reset}>
              {TRY_AGAIN_LABEL}
            </button>
            {/* A plain <a>, not next/link: the router may be what failed. */}
            <a href="/">{BACK_TO_KUSTOM_LABEL}</a>
          </div>
          {error.digest === undefined ? null : <p>{errorReference(error.digest)}</p>}
        </main>
        {/* Riot's notice on every page (M14.8), even this one. */}
        <footer>{RIOT_NOTICE}</footer>
      </body>
    </html>
  );
}
