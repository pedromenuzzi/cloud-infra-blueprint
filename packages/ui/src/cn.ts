import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge classNames with Tailwind-aware deduping. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
