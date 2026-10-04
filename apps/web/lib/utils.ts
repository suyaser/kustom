import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class names for the Kustom 2.0 components (M14.1): conditional parts through `clsx`, then
 * `tailwind-merge` so a caller's `className` wins over a component's default for the same
 * property. The shadcn primitives in `components/ui` import it under this name.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
