import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { plain, rich } from './rich';

const html = (text: string) => renderToStaticMarkup(createElement('p', null, rich(text))).replace(/ class="[^"]*"/g, '');

describe('lesson prose', () => {
  it('turns backticks into code and stars into emphasis', () => {
    expect(html('Drag an *S3 bucket*: it writes a `resource` block.')).toBe(
      '<p>Drag an <em>S3 bucket</em>: it writes a <code>resource</code> block.</p>',
    );
  });

  it('leaves stars inside code and unpaired stars alone', () => {
    expect(html('`a * b` costs 5 * 3')).toBe('<p><code>a * b</code> costs 5 * 3</p>');
  });

  it('strips the marks for plain text', () => {
    expect(plain('The bucket has a `bucket` name, *really*')).toBe('The bucket has a bucket name, really');
  });
});
