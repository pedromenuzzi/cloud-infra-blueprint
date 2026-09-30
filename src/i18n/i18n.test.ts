import { afterEach, describe, expect, it } from 'vitest';
import { formatList, formatNumber, formatRelativeTime, formatUsd } from './format';
import { currentLocale, useLocale } from './locale';
import { defineMessages, messagesFor } from './messages';

const messages = defineMessages(
  { title: 'Projects', deleted: (n: number) => `Deleted ${n} project${n === 1 ? '' : 's'}` },
  { title: 'Projetos', deleted: (n: number) => `${n} projeto${n === 1 ? '' : 's'} excluído${n === 1 ? '' : 's'}` },
);

afterEach(() => useLocale.getState().setLocale('en'));

describe('i18n', () => {
  it('follows the language in effect', () => {
    expect(messagesFor(messages).title).toBe('Projects');
    useLocale.getState().setLocale('pt-BR');
    expect(currentLocale()).toBe('pt-BR');
    expect(messagesFor(messages).title).toBe('Projetos');
    expect(messagesFor(messages).deleted(2)).toBe('2 projetos excluídos');
    expect(messagesFor(messages, 'en').deleted(1)).toBe('Deleted 1 project');
  });

  it('keeps both languages in step at compile time', () => {
    // @ts-expect-error — a Portuguese object missing a key doesn't compile
    defineMessages({ a: 'A', b: 'B' }, { a: 'A' });
    // @ts-expect-error — nor one with a key English doesn't have
    defineMessages({ a: 'A' }, { a: 'A', extra: 'X' });
    // @ts-expect-error — nor a function with another signature
    defineMessages({ n: (n: number) => `${n}` }, { n: (s: string) => s });
  });

  it('formats numbers, money, lists and times per language', () => {
    expect(formatNumber(1234.5, undefined, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, undefined, 'pt-BR')).toBe('1.234,5');
    expect(formatUsd(27.4, undefined, 'en')).toBe('$27.40');
    expect(formatUsd(27.4, undefined, 'pt-BR').replace(/\s/g, ' ')).toBe('US$ 27,40');
    expect(formatList(['a', 'b', 'c'], 'conjunction', 'pt-BR')).toBe('a, b e c');
    const now = Date.UTC(2026, 8, 29, 12);
    expect(formatRelativeTime(now - 3 * 3600_000, now, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime(now - 3 * 3600_000, now, 'pt-BR')).toBe('há 3 horas');
    expect(formatRelativeTime(now - 5_000, now, 'pt-BR')).toBe('agora');
  });
});
