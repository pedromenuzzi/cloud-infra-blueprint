/** The price tables live in their own chunk, fetched the first time an estimate is shown. */
import type { PriceBook } from './types';

let book: PriceBook | null = null;
let pending: Promise<PriceBook> | null = null;
const listeners = new Set<() => void>();

export function loadPriceBook(): Promise<PriceBook> {
  pending ??= import('./prices').then(
    (m) => {
      book = m.PRICE_BOOK;
      listeners.forEach((l) => l());
      return book;
    },
    (err: unknown) => {
      // a failed chunk load (offline, a new deploy) may be retried later
      pending = null;
      throw err;
    },
  );
  return pending;
}

/** the tables if they are loaded already */
export function loadedPriceBook(): PriceBook | null {
  return book;
}

export function onPriceBookLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
