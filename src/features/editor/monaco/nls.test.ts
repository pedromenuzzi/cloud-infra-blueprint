/**
 * Monaco's words in Portuguese (./nls.messages.ts) are matched by Monaco's
 * own English: each must still be a text Monaco localizes, or an upgrade
 * would quietly put it back in English.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { monacoTable } from './nls';
import { monacoMessages } from './nls.messages';

const VS = 'node_modules/monaco-editor/esm/vs';
/** the widgets the app loads (./contribs.ts) and their parts */
const SOURCES = [
  'editor/contrib/find',
  'editor/contrib/suggest',
  'editor/contrib/hover',
  'editor/contrib/clipboard',
  'editor/contrib/multicursor',
  'editor/contrib/format',
  'editor/contrib/gotoError',
  'editor/contrib/peekView',
  'base/browser/ui/findinput',
  'editor/common/standaloneStrings.js',
];

function sources(path: string): string[] {
  if (!statSync(path).isDirectory()) return path.endsWith('.js') ? [readFileSync(path, 'utf8')] : [];
  return readdirSync(path).flatMap((name) => sources(join(path, name)));
}

const localized = new Set(
  SOURCES.flatMap((path) => sources(join(VS, path))).flatMap((src) =>
    [...src.matchAll(/localize2?\(\s*'[^']+',\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)].map((m) => m[1] ?? m[2]),
  ),
);

describe('Monaco in Portuguese', () => {
  it('translates texts Monaco still localizes', () => {
    const missing = Object.values(monacoMessages.en).filter((text) => !localized.has(text));
    expect(missing).toEqual([]);
  });

  it('maps English to the language in effect, and nothing for English', () => {
    expect(monacoTable('en')).toBeUndefined();
    const pt = monacoTable('pt-BR')!;
    expect(pt['Find']).toBe('Buscar');
    expect(pt['{0} of {1}']).toBe('{0} de {1}');
    expect(Object.keys(pt)).toHaveLength(Object.keys(monacoMessages.en).length);
  });
});
