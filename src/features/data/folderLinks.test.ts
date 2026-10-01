import { describe, expect, it } from 'vitest';
import { createLink, type DirHandleLike, type FolderLink, type LinkStore } from '@/lib/fsSync';
import { forgetFolderLink, readFolderLinks } from './folderLinks';

const dir = (name: string) => ({ kind: 'directory', name }) as DirHandleLike;

function memoryStore(links: FolderLink[], { failDelete = false } = {}): LinkStore & { data: Map<string, FolderLink> } {
  const data = new Map(links.map((l) => [l.projectId, l] as const));
  return {
    data,
    get: async (id) => data.get(id),
    set: async (link) => void data.set(link.projectId, link),
    delete: async (id) => {
      if (failDelete) throw new Error('IndexedDB is blocked by another tab');
      data.delete(id);
    },
    all: async () => [...data.values()],
  };
}

describe('folder links on the dashboard', () => {
  it('names the folder of each linked project', async () => {
    const store = memoryStore([
      createLink({ projectId: 'prj_a', dir: dir('infra'), label: 'infra' }),
      createLink({ projectId: 'prj_b', dir: dir('infra'), label: 'repo/infra' }),
    ]);
    const labels = await readFolderLinks(store, () => true);
    expect([...labels]).toEqual([
      ['prj_a', 'infra'],
      ['prj_b', 'repo/infra'],
    ]);
  });

  it('drops the links of projects that are gone, and keeps the others', async () => {
    const store = memoryStore([
      createLink({ projectId: 'prj_kept', dir: dir('a'), label: 'a' }),
      createLink({ projectId: 'prj_deleted', dir: dir('b'), label: 'b' }),
    ]);
    const labels = await readFolderLinks(store, (id) => id === 'prj_kept');
    expect([...labels.keys()]).toEqual(['prj_kept']);
    expect([...store.data.keys()]).toEqual(['prj_kept']);
  });

  it('forgets a deleted project’s link, quietly when the store fails', async () => {
    const store = memoryStore([createLink({ projectId: 'prj_a', dir: dir('a'), label: 'a' })]);
    await forgetFolderLink('prj_a', store);
    expect(store.data.size).toBe(0);
    await expect(forgetFolderLink('prj_missing', store)).resolves.toBeUndefined();
    const failing = memoryStore([createLink({ projectId: 'prj_a', dir: dir('a'), label: 'a' })], { failDelete: true });
    await expect(forgetFolderLink('prj_a', failing)).resolves.toBeUndefined();
    // …and a link that can't be dropped still isn't shown for a project that's gone
    expect((await readFolderLinks(failing, () => false)).size).toBe(0);
  });
});
