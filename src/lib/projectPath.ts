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

export function isProjectFilePath(path: string): boolean {
  if (path === '__proto__') return false;
  const segments = path.split('/');
  return segments.length <= MAX_DEPTH + 1 && segments.every((s) => PROJECT_SEGMENT.test(s));
}
