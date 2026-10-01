import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadedPriceBook, loadPriceBook, onPriceBookLoaded } from '@/cost/load';
import { projectCostWithModules } from '@/cost/modules';
import type { PriceBook, ProjectCost } from '@/cost/types';
import { useEditor } from '@/features/editor/store';
import { useModuleView } from '@/features/modules/moduleViewStore';
import { analysisIr } from '@/features/modules/viewAnalysis';
import { useLocale } from '@/i18n/locale';

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

/**
 * The estimate of the open project, local modules' resources included
 * (whatever module is open on the canvas), recomputed when its code changes
 * and re-worded when the language does.
 */
export function useProjectCost(): { cost: ProjectCost | null; failed: boolean; retry(): void } {
  const ir = useEditor((s) => s.rootIr);
  const files = useEditor((s) => s.files);
  const locale = useLocale((s) => s.locale);
  const { book, failed, retry } = usePriceBook();
  return { cost: book ? projectCostWithModules(ir, files, book, locale) : null, failed, retry };
}

/**
 * The estimate of what's on the canvas: the project, or the opened module
 * as the calls leading to it make it (one instance of it) — what the
 * inspector's cost line reads a resource's amount from.
 */
export function useViewCost(): ProjectCost | null {
  const ir = useEditor((s) => s.ir);
  const scoped = useEditor((s) => s.scope !== null);
  const files = useEditor((s) => s.files);
  const path = useModuleView((s) => s.path);
  const locale = useLocale((s) => s.locale);
  const { book } = usePriceBook();
  if (!book) return null;
  const steps = scoped ? path.map(({ dir, name }) => ({ dir, name })) : [];
  return projectCostWithModules(scoped ? analysisIr(ir) : ir, files, book, locale, steps);
}
