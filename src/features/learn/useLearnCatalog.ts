/**
 * The learning map's lessons, loaded on demand. The build side (dashboard,
 * inspector, ⌘K) links into the map, but its pages shouldn't carry every
 * lesson, goal and the simulator just for a link: this hook loads them the
 * first time it's used and hands back null until then.
 */
import { useEffect, useState } from 'react';

type Catalog = typeof import('@/learn/lessons') & Pick<typeof import('./trail'), 'continueLesson'>;

let loaded: Catalog | null = null;
let pending: Promise<Catalog> | null = null;

export function loadLearnCatalog(): Promise<Catalog> {
  pending ??= Promise.all([import('@/learn/lessons'), import('./trail')]).then(
    ([lessons, trail]) => (loaded = { ...lessons, continueLesson: trail.continueLesson }),
  );
  return pending;
}

/** the lessons once loaded (null before); `when` false defers loading */
export function useLearnCatalog(when = true): Catalog | null {
  const [catalog, setCatalog] = useState(loaded);
  useEffect(() => {
    if (catalog || !when) return;
    let live = true;
    void loadLearnCatalog().then((c) => live && setCatalog(c));
    return () => {
      live = false;
    };
  }, [catalog, when]);
  return catalog;
}
