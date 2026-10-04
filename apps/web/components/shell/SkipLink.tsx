import { SKIP_LINK_LABEL } from '@/lib/shellCopy';

/**
 * First in the DOM (05-design.md 6.2): visually hidden until focused, then a level-2 chip top left.
 * It targets the shell's `<main id="main">`.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-control focus:border focus:border-border-strong focus:bg-raised focus:px-4 focus:font-bold"
    >
      {SKIP_LINK_LABEL}
    </a>
  );
}
