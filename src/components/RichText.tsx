import { createElement, Fragment, type ReactNode } from 'react';

/**
 * A translated sentence with inline code: `backticks` become `<code>`, so
 * each language puts the code where its own word order wants it
 * ('Review the code before running `terraform apply` — …'). Only for message
 * text — never for user data, which may contain backticks.
 */
export function richText(text: string, codeClassName = 'font-mono'): ReactNode {
  const parts = text
    .split('`')
    .map((segment, i) => (i % 2 === 1 ? createElement('code', { key: i, className: codeClassName }, segment) : segment))
    .filter((part) => part !== '');
  return createElement(Fragment, null, ...parts);
}
