/**
 * How a repeated resource is labelled wherever it is drawn (canvas badge,
 * accessible name, PDF diagram): "×3", "×0–1", "×?", "for_each: var.azs".
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { exprText, type Repeat } from '@/ir/repeat';
import { repeatMessages } from './RepeatSection.messages';

export interface RepeatLabel {
  /** the badge: code-like, the same in every language */
  text: string;
  /** the tooltip: what the badge means */
  title: string;
  /** appended to the node's accessible name */
  aria: string;
}

const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function repeatLabel(rep: Repeat, locale: Locale = currentLocale()): RepeatLabel {
  const m = messagesFor(repeatMessages, locale);
  const source = `${rep.kind} = ${exprText(rep.expr).replace(/\s+/g, ' ')}`;
  if (rep.size !== undefined) {
    const keys = rep.kind === 'for_each' && rep.keys?.length ? ` · ${m.badgeKeys(rep.keys.slice(0, 6).join(', '))}${rep.keys.length > 6 ? '…' : ''}` : '';
    return { text: `×${rep.size}`, title: `${short(source, 60)} — ${m.badgeInstances(rep.size)}${keys}`, aria: m.ariaInstances(rep.size) };
  }
  if (rep.optional) return { text: '×0–1', title: `${short(source, 60)} — ${m.badgeOptional}`, aria: m.ariaOptional };
  if (rep.kind === 'count') return { text: '×?', title: `${short(source, 60)} — ${m.badgeUnknownCount}`, aria: m.ariaRepeated };
  return {
    text: `for_each: ${short(exprText(rep.expr).replace(/\s+/g, ' '))}`,
    title: `${short(source, 60)} — ${m.badgeUnknownEach}`,
    aria: m.ariaRepeated,
  };
}
