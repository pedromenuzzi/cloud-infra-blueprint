/**
 * Applies a waiting new version on its own, on a screen where nothing is in
 * progress (./autoUpdate.ts), reloading once; elsewhere the "Update
 * available" prompt asks. Mounted inside the router (it follows the route).
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useToasts } from '@/components/Toast';
import { isQuietRoute, screenIsIdle } from './autoUpdate';
import { autoApplyUpdate, usePwa } from './pwa';

/** how often a busy quiet screen is looked at again (a dialog closed, a field cleared) */
const RECHECK_MS = 1000;

export function AutoUpdate() {
  const { pathname, hash } = useLocation();
  const updateReady = usePwa((s) => s.updateReady);
  const quiet = isQuietRoute(pathname, hash);

  useEffect(() => {
    if (!updateReady || !quiet) return;
    let tried = false;
    const attempt = () => {
      if (tried) return;
      const toasts = useToasts.getState().toasts.filter((t) => t.action).length;
      if (!screenIsIdle(document, toasts)) return;
      // one try per page load: refused by the reload-loop guard, the prompt stays
      tried = true;
      autoApplyUpdate();
    };
    attempt();
    const timer = window.setInterval(attempt, RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [updateReady, quiet]);

  return null;
}
