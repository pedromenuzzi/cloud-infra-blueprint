import { useEffect } from 'react';

export const APP_NAME = 'Cloud Blueprint';
export const DEFAULT_TITLE = `${APP_NAME} — Design cloud infrastructure visually. Ship Terraform instantly.`;

/** Formats a page title the way every route does: "<page> — Cloud Blueprint". */
export function pageTitle(title?: string | null): string {
  const clean = title?.trim();
  return clean ? `${clean} — ${APP_NAME}` : DEFAULT_TITLE;
}

/**
 * Sets `document.title` while the calling component is mounted, e.g.
 * `useDocumentTitle(projectName)` → "my-app — Cloud Blueprint". A falsy
 * title shows the default (landing) title.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = pageTitle(title);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
