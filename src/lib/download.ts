import { strToU8, zipSync } from 'fflate';
import { messagesFor } from '@/i18n/messages';
import { REPO_URL } from './links';
import { libMessages } from './messages';
import { slugify } from './utils';
import { zipLayout } from './zipLayout';

/** The zip's README, in the UI language of the moment (`root`: the root module's folder in it). */
function terraformReadme(name: string, files: string[], root: string): string {
  return messagesFor(libMessages).exportReadme(name, REPO_URL, files.map((f) => `- \`${f}\``).join('\n'), root);
}

/**
 * Download the project as a Terraform zip. The root module goes back into
 * the folders it was imported from (`rootPath`) when its module sources
 * climb out of it (src/lib/zipLayout.ts).
 */
export function exportZip(name: string, files: Record<string, string>, options: { rootPath?: string } = {}) {
  const kept: Record<string, string> = {};
  for (const [file, text] of Object.entries(files)) if (text.trim().length > 0) kept[file] = text;
  const layout = zipLayout(kept, { rootPath: options.rootPath, name });
  const entries: Record<string, Uint8Array> = {};
  const names = Object.keys(layout.entries);
  for (const file of names) entries[file] = strToU8(layout.entries[file]);
  entries['README.md'] = strToU8(terraformReadme(name, names, layout.root));

  const zipped = zipSync(entries, { level: 6 });
  downloadBlob(new Blob([zipped.slice().buffer], { type: 'application/zip' }), `${slugify(name)}-terraform.zip`);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
