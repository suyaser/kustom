/**
 * A live count as the landing page prints it (STRATEGY §2.3): **rounded down**, so the page never
 * claims more than is true, and never a zero (a count with nothing in it is hidden, not shown at
 * 0). Under ten it is the exact number; from ten it is cut to the ten below with a `+`
 * (`487` -> `480+`, `1234` -> `1,230+`). `null` means "do not show this count".
 */
export function roundedCount(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const whole = Math.floor(n);
  if (whole <= 0) return null;
  if (whole < 10) return String(whole);
  return `${(Math.floor(whole / 10) * 10).toLocaleString('en-GB')}+`;
}
