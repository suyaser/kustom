/** Overlay version, stamped at build time. */

declare const __CUSTOMS_NIGHT_OVERLAY_VERSION__: string | undefined;

export const OVERLAY_VERSION: string =
  typeof __CUSTOMS_NIGHT_OVERLAY_VERSION__ === 'string' && __CUSTOMS_NIGHT_OVERLAY_VERSION__.length > 0
    ? __CUSTOMS_NIGHT_OVERLAY_VERSION__
    : '0.1.0';
