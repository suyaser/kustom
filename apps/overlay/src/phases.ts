/**
 * Phases that show the overlay panel (M12). Everything else hides it.
 * Champ-select events themselves are never read — only this gameflow string.
 */

export const SHOW_PHASES = new Set(['Lobby', 'ChampSelect']);

export function shouldShowOverlay(phase: string | null): boolean {
  return phase !== null && SHOW_PHASES.has(phase);
}
