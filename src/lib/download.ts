import { strToU8, zipSync } from 'fflate';
import { messagesFor } from '@/i18n/messages';
import { REPO_URL } from './links';
import { libMessages } from './messages';
import { slugify } from './utils';

/** The zip's README, in the UI language of the moment. */
function terraformReadme(name: string, files: string[]): string {
  return messagesFor(libMessages).exportReadme(name, REPO_URL, files.map((f) => `- \`${f}\``).join('\n'));
}

export function exportZip(name: string, files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  const names = Object.keys(files).filter((f) => files[f].trim().length > 0);
  for (const file of names) entries[file] = strToU8(files[file]);
  entries['README.md'] = strToU8(terraformReadme(name, names));

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
