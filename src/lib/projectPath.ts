/**
 * Project file paths: a root-module file is a bare name (`main.tf`), a child
 * module's file sits in its folder (`modules/net/main.tf`). Each segment is
 * letters, digits, `_`, `.`, `-` — and not just dots (`.`, `..`) — so a path
 * is safe in a share link, a zip and a folder alike.
 */

/** One segment of a project path. */
export const PROJECT_SEGMENT = /^(?!\.+$)[\p{L}\p{N}_.-]{1,120}$/u;

/** Folders a child module may sit in, at most. */
const MAX_DEPTH = 8;

/**
 * The folder a project's root module came from, as imported (`envs/prod`):
 * kept when it's a safe relative path, else dropped. The Terraform zip puts
 * the root module back there when its module sources climb out of it.
 */
export function safeRootPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const segments = value.split('/');
  return segments.length <= MAX_DEPTH && segments.every((s) => PROJECT_SEGMENT.test(s)) ? value : undefined;
}

export function isProjectFilePath(path: string): boolean {
  if (path === '__proto__') return false;
  const segments = path.split('/');
  return segments.length <= MAX_DEPTH + 1 && segments.every((s) => PROJECT_SEGMENT.test(s));
}
