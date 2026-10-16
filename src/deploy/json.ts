/**
 * What a plan and a state have in common: they arrive as untrusted JSON
 * files, read here in the browser and never sent anywhere, and their values
 * are addressed by attribute paths (`tags.env`, `ingress[0].from_port`).
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type PathStep = string | number;

/** a plan or a state bigger than this is refused before it's read (real ones of a few thousand resources stay well under) */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `tags.env`, `ingress[0].from_port`, `tags["kubernetes.io/role"]` */
export function pathKey(steps: readonly PathStep[]): string {
  let out = '';
  for (const step of steps) {
    if (typeof step === 'number') out += `[${step}]`;
    else if (/^[A-Za-z_][\w-]*$/.test(step)) out += out ? `.${step}` : step;
    else out += `[${JSON.stringify(step)}]`;
  }
  return out;
}

/** `[0]` or `["a"]`: an instance key as Terraform writes it in an address */
export const indexSuffix = (key: string | number | undefined): string =>
  key === undefined ? '' : typeof key === 'number' ? `[${key}]` : `[${JSON.stringify(key)}]`;

/**
 * The canvas node a resource is drawn as: `aws_vpc.main`, `data.aws_ami.ubuntu`,
 * or the module call it lives under (`module.net`, whatever is nested below).
 */
export function nodeIdFor(r: { mode: string; type: string; name: string; module?: string }): string {
  const call = r.module ? /^module\.([A-Za-z_][\w-]*)/.exec(r.module)?.[1] : undefined;
  if (call) return `module.${call}`;
  return r.mode === 'data' ? `data.${r.type}.${r.name}` : `${r.type}.${r.name}`;
}

/** attribute names that hold secrets even when nothing marks them sensitive */
export const SECRET_NAME = /(^|_)pass(word|phrase)?($|_)|password|secret|token|private_key|access_key|api_key|connection_string|(^|_)credentials?$/i;

export type FileKind = 'plan' | 'state' | 'state-json' | 'binary-plan';

/** What a file holds, from its first bytes and shape; null when it's neither a plan nor a state. */
export function sniff(text: string, value: unknown): FileKind | null {
  // a saved plan (`-out=tfplan`) is a zip
  if (text.startsWith('PK')) return 'binary-plan';
  if (!isObject(value)) return null;
  if ('resource_changes' in value || ('planned_values' in value && 'format_version' in value)) return 'plan';
  if ('values' in value && 'format_version' in value) return 'state-json';
  if ('version' in value && ('resources' in value || 'lineage' in value)) return 'state';
  return null;
}

export type ReadResult = { ok: true; text: string; value: unknown; kind: FileKind | null } | { ok: false; error: 'too-large' | 'unreadable' | 'not-json' | 'binary-plan' };

/** Read a picked or dropped file: size first, then JSON. */
export async function readJsonFile(file: Blob): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'too-large' };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  return readJsonText(text);
}

export function readJsonText(text: string): ReadResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'too-large' };
  if (text.startsWith('PK')) return { ok: false, error: 'binary-plan' };
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'not-json' };
  }
  return { ok: true, text, value, kind: sniff(text, value) };
}
