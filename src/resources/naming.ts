/**
 * Cloud-side names. The Terraform label (`lb_2`, `web_copy`) is an HCL
 * identifier; the name a resource gets in the cloud follows the provider's
 * rules instead — most only allow lowercase letters, digits and hyphens, some
 * only letters and digits (storage accounts, registries), a few underscores
 * (BigQuery datasets), and many cap the length.
 */
import type { NamingRule, ResourceDef } from './types';

const SEPARATOR = { hyphen: '-', alnum: '', underscore: '_', dns: '-' } as const;

function clean(text: string, rule: NamingRule): string {
  const style = rule.style ?? 'hyphen';
  if (style === 'alnum') return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (style === 'underscore') {
    return text
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** hyphens and underscores must not end a truncated name */
const trimEnd = (s: string) => s.replace(/[-_]+$/, '');

/**
 * `base` (+ `suffix`) as a valid cloud name under `rule`: invalid characters
 * replaced, starts with a letter, and truncated to `maxLength` — the base is
 * shortened first so a suffix like `copy` or `2` survives.
 */
export function cloudName(base: string, rule: NamingRule = {}, suffix?: string): string {
  const style = rule.style ?? 'hyphen';
  const sep = SEPARATOR[style];
  const tail = suffix ? clean(suffix, rule) : '';
  let head = clean(base, rule) || 'main';
  if (!/^[A-Za-z]/.test(head)) head = `r${sep}${head}`;
  const room = (rule.maxLength ?? Infinity) - (tail ? sep.length + tail.length : 0);
  if (head.length > room) head = trimEnd(head.slice(0, Math.max(1, room)));
  let name = tail ? `${head}${sep}${tail}` : head;
  if (rule.maxLength && name.length > rule.maxLength) name = trimEnd(name.slice(0, rule.maxLength));
  if (rule.minLength && name.length < rule.minLength) name = name.padEnd(rule.minLength, '0');
  return style === 'dns' ? `${name}.${rule.domain ?? 'example.com.'}` : name;
}

/** The name argument prefilled for a new resource labelled `label` (`lb_2` → `lb-2`). */
export function nameForLabel(def: ResourceDef, label: string): string {
  return cloudName(label, def.naming);
}

const COPY_SUFFIX = /[-_]?copy(?:[-_]?\d+)?$/;

/**
 * The cloud-side name for a copy: `web-sg` → `web-sg-copy`, a second copy
 * `web-sg-copy-2` (the counter follows the Terraform label). DNS names get the
 * suffix on their first label: `www.example.com.` → `www-copy.example.com.`.
 */
export function copyName(def: ResourceDef | undefined, current: string, copyLabel: string): string {
  const rule = def?.naming ?? {};
  const counter = /_(\d+)$/.exec(copyLabel)?.[1];
  const suffix = counter ? `copy-${counter}` : 'copy';
  if (rule.style === 'dns') {
    const dot = current.indexOf('.');
    const first = dot === -1 ? current : current.slice(0, dot);
    const domain = dot === -1 ? rule.domain : current.slice(dot + 1);
    return cloudName(first.replace(COPY_SUFFIX, ''), { ...rule, domain }, suffix);
  }
  const name = cloudName(current.replace(COPY_SUFFIX, ''), rule, suffix);
  // `photocopy` isn't a copy of anything — keep its whole name
  return name === current ? cloudName(current, rule, suffix) : name;
}

/** Slug for cloud-side names in templates: lowercase letters, digits and hyphens. */
export function nameSlug(text: string): string {
  return clean(text, { style: 'hyphen' }) || 'app';
}
