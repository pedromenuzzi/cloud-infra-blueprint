import { useEffect, useState, useSyncExternalStore } from 'react';
import { projectCost } from '@/cost/estimate';
import { loadedPriceBook, loadPriceBook, onPriceBookLoaded } from '@/cost/load';
import type { PriceBook, ProjectCost } from '@/cost/types';
import { useEditor } from '@/features/editor/store';

/** the price tables; starts loading them on first use. `failed` when the chunk couldn't be fetched */
export function usePriceBook(): { book: PriceBook | null; failed: boolean; retry(): void } {
  const book = useSyncExternalStore(onPriceBookLoaded, loadedPriceBook, loadedPriceBook);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (book) return;
    let live = true;
    loadPriceBook().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [book, attempt]);
  return {
    book,
    failed: failed && !book,
    retry: () => {
      setFailed(false);
      setAttempt((a) => a + 1);
    },
  };
}

/** the estimate of the open project, recomputed when its IR changes */
export function useProjectCost(): { cost: ProjectCost | null; failed: boolean; retry(): void } {
  const ir = useEditor((s) => s.ir);
  const { book, failed, retry } = usePriceBook();
  return { cost: book ? projectCost(ir, book) : null, failed, retry };
}
