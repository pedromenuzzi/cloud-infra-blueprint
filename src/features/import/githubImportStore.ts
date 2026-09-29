/**
 * Tiny, always-loaded state for the (lazily loaded) "Import from GitHub"
 * dialog — the dashboard, the command palette and `#gh=` links open it.
 *
 * The optional personal access token lives HERE, in this tab's memory only:
 * it is never written to storage, never put in a URL, and is gone on reload.
 */
import { create } from 'zustand';
import type { RateLimit } from '@/lib/githubImport';

interface GithubImportState {
  open: boolean;
  /** what the link field starts with */
  prefill: string;
  /** opened by a `#gh=` link: the primary action takes focus, nothing runs until it's pressed */
  fromLink: boolean;
  /** bumped on every open, so the dialog starts fresh */
  session: number;
  /** personal access token — memory only */
  token: string;
  /** the last X-RateLimit-* GitHub reported */
  rate: RateLimit | null;
}

export const useGithubImport = create<GithubImportState>(() => ({
  open: false,
  prefill: '',
  fromLink: false,
  session: 0,
  token: '',
  rate: null,
}));

export function openGithubImport(prefill = '', options: { fromLink?: boolean } = {}) {
  useGithubImport.setState((s) => ({
    open: true,
    prefill,
    fromLink: options.fromLink === true,
    session: s.session + 1,
  }));
}

export function closeGithubImport() {
  useGithubImport.setState({ open: false });
}

const GH_FRAGMENT = /^#gh=(.+)$/s;

/** `#gh=owner/repo[/path][@ref]` → what to prefill; null when the fragment isn't one. */
export function readGithubFragment(hash: string): string | null {
  const m = GH_FRAGMENT.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 2048) || null;
  } catch {
    return null;
  }
}
