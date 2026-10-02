/**
 * When a new version can be applied without asking: on the screens where
 * nothing is ever in progress (the landing page, the dashboard, the tutorials
 * list, the 404 page), as long as no dialog or menu is open, nothing has been
 * typed into a field and no "Undo" is still on offer. The editor, a tutorial
 * lesson and the viewer keep the "Update available" prompt (./UpdatePrompt.tsx).
 */
import { isViewHash } from '@/lib/share';

/** routes that hold work in progress (an open project, a lesson, a shared diagram) */
const BUSY_ROUTES = [/^\/editor\/[^/]+$/, /^\/tutorials\/[^/]+$/];

/**
 * `pathname` is relative to the app's base path (React Router's location):
 * the landing page, /dashboard, /tutorials and any unknown path (404) are
 * quiet; the editor, a lesson and the viewer (`/#view=…`) are not.
 */
export function isQuietRoute(pathname: string, hash = ''): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return !isViewHash(hash);
  return !BUSY_ROUTES.some((route) => route.test(path));
}

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'password', 'number', 'tel']);

/** a field someone types into (not a checkbox, a file picker or a read-only one) */
function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled;
  if (tag !== 'input') return false;
  const input = el as HTMLInputElement;
  return TEXT_TYPES.has((input.getAttribute('type') ?? '').toLowerCase()) && !input.readOnly && !input.disabled;
}

const shown = (el: Element) => el.getClientRects().length > 0;

/**
 * Nothing on screen would be lost by a reload: no open dialog or menu, no
 * focused text field, no field with something typed in it, and no toast still
 * offering an action (`actionToasts`).
 */
export function screenIsIdle(doc: Document, actionToasts: number): boolean {
  if (actionToasts > 0) return false;
  const layers = doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]');
  if (Array.from(layers).some(shown)) return false;
  const active = doc.activeElement;
  if (active && (isTextField(active) || (active as HTMLElement).isContentEditable)) return false;
  for (const el of Array.from(doc.querySelectorAll('input, textarea'))) {
    if (isTextField(el) && el.value.trim() !== '' && shown(el)) return false;
  }
  return true;
}
