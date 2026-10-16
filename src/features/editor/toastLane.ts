import { useEffect, type RefObject } from 'react';
import { floatingInspectorInset, toolPanelInset } from './inspectorPlacement';

/** the narrowest lane worth centering toasts in, px */
const TOAST_LANE_MIN = 320;

/**
 * Where toasts go while a page with a canvas is up (Toast's --bp-toast-*
 * variables), the editor's or a lesson's: above the canvas toolbar,
 * centered in the canvas the floating panels and drawers leave uncovered, so a
 * toast never lands on the inspector, the code or an open panel. A phone has no
 * such lane beside the inspector: they span the canvas at its bottom edge, over
 * the panels' footers rather than their fields. `arrangement` changes as the
 * panels come, go or move.
 */
export function useToastLane(canvas: RefObject<HTMLElement | null>, shown: boolean, arrangement: string) {
  useEffect(() => {
    const el = canvas.current;
    const root = document.documentElement.style;
    // a custom property on the root restyles the whole page: only when it changes
    const set = (name: string, value: string | null) => {
      if (value === null) root.removeProperty(name);
      else if (root.getPropertyValue(name) !== value) root.setProperty(name, value);
    };
    if (!el || !shown) {
      // a hidden canvas: the code is the whole stage, toasts center on the window
      set('--bp-toast-bottom', '4.5rem');
      set('--bp-toast-left', null);
      set('--bp-toast-right', null);
      return;
    }
    const place = () => {
      const rect = el.getBoundingClientRect();
      let left = rect.left + toolPanelInset(rect.width);
      let right = rect.right - floatingInspectorInset(rect.width);
      for (const drawer of el.ownerDocument.querySelectorAll<HTMLElement>('[data-drawer]')) {
        if (drawer.dataset.drawer === 'left') left = Math.max(left, rect.left + drawer.offsetWidth);
        else right = Math.min(right, rect.right - drawer.offsetWidth);
      }
      const narrow = right - left < TOAST_LANE_MIN;
      if (narrow) ({ left, right } = rect);
      // above the canvas toolbar (a lesson's terminal, docked below the canvas, too)
      set('--bp-toast-bottom', `${Math.round(window.innerHeight - rect.bottom) + (narrow ? 16 : 72)}px`);
      set('--bp-toast-left', `${Math.round(left) + 12}px`);
      set('--bp-toast-right', `${Math.round(window.innerWidth - right) + 12}px`);
    };
    // measured when the observer first reports, right after the browser's own layout: measuring
    // here, mid commit, would force an extra layout of the whole canvas
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvas, shown, arrangement]);
  useEffect(() => {
    const root = document.documentElement.style;
    return () => ['--bp-toast-bottom', '--bp-toast-left', '--bp-toast-right'].forEach((name) => root.removeProperty(name));
  }, []);
}
