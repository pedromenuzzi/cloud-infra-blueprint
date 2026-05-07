import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router-dom';

/**
 * Top-of-viewport progress strip rendered while React Router is fetching a
 * lazy route chunk. Mounted in `router.tsx` so every route gets it without
 * needing to remember to add a Suspense boundary.
 *
 * Implementation notes:
 *   - We render NOTHING when navigation is idle, so there's zero DOM cost on
 *     the hot path.
 *   - The 200ms debounce avoids flashing the bar on instant transitions
 *     (already-loaded chunks).
 *   - `aria-hidden` because the bar is decorative; screen readers get the
 *     state from `useNavigation()` if the page wires it up later.
 */
export function RouteProgress() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== 'idle';
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShow(false);
      return;
    }
    const id = window.setTimeout(() => setShow(true), 200);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  if (!show) return null;
  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-transparent">
      <div className="h-full w-1/3 animate-[routeProgress_1.1s_ease-in-out_infinite] bg-primary" />
      <style>{`
        @keyframes routeProgress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(220%); }
        }
      `}</style>
    </div>
  );
}
