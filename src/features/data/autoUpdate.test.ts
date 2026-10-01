import { describe, expect, it } from 'vitest';
import { isQuietRoute, screenIsIdle } from './autoUpdate';

describe('screens where a new version is applied without asking', () => {
  it('the landing page, the dashboard, the tutorials list and any 404', () => {
    for (const path of ['/', '', '/dashboard', '/dashboard/', '/tutorials', '/tutorials/', '/nope', '/editor', '/a/b/c']) {
      expect(isQuietRoute(path), path).toBe(true);
    }
  });

  it('not the editor, a tutorial lesson or the viewer (embedded too)', () => {
    expect(isQuietRoute('/editor/prj_1')).toBe(false);
    expect(isQuietRoute('/editor/prj_1/')).toBe(false);
    expect(isQuietRoute('/tutorials/first-vpc')).toBe(false);
    expect(isQuietRoute('/', '#view=abc')).toBe(false);
    expect(isQuietRoute('/', '#view=abc&embed=1')).toBe(false);
    // another fragment on the landing page is still the landing page
    expect(isQuietRoute('/', '#features')).toBe(true);
  });
});

/** a tiny stand-in for the document: what screenIsIdle asks of it */
function fakeDoc({ layers = 0, active, fields = [] }: { layers?: number; active?: Partial<HTMLInputElement>; fields?: Array<Partial<HTMLInputElement>> }) {
  const el = (props: Partial<HTMLInputElement>) => ({ tagName: 'INPUT', getAttribute: () => 'text', readOnly: false, disabled: false, value: '', getClientRects: () => [1], ...props });
  return {
    activeElement: active ? el(active) : { tagName: 'BODY', isContentEditable: false },
    querySelectorAll: (selector: string) =>
      selector.startsWith('[role="dialog"]') ? Array.from({ length: layers }, () => ({ getClientRects: () => [1] })) : fields.map(el),
  } as unknown as Document;
}

describe('a screen with nothing in progress', () => {
  it('is idle with no dialog, no focused or filled field and no toast offering an action', () => {
    expect(screenIsIdle(fakeDoc({}), 0)).toBe(true);
    expect(screenIsIdle(fakeDoc({ fields: [{ value: '' }] }), 0)).toBe(true);
  });

  it('is busy otherwise', () => {
    expect(screenIsIdle(fakeDoc({ layers: 1 }), 0)).toBe(false);
    expect(screenIsIdle(fakeDoc({ active: { value: '' } }), 0)).toBe(false);
    expect(screenIsIdle(fakeDoc({ fields: [{ value: 'prod' }] }), 0)).toBe(false);
    expect(screenIsIdle(fakeDoc({}), 1)).toBe(false);
    // a read-only field with text in it doesn't count
    expect(screenIsIdle(fakeDoc({ fields: [{ value: 'x', readOnly: true }] }), 0)).toBe(true);
  });
});
