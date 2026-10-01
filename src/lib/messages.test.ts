/**
 * Text made outside React follows the UI language at the moment it is made.
 * English is covered by each module's own tests; these check the Portuguese.
 */
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocale } from '@/i18n/locale';
import { buildBackup, parseBackup, validateManifest } from './backup';
import { exportZip } from './download';
import { folderProblemText } from './fsSync';
import { formatBytes as githubBytes, parseGithubInput, resetTime } from './githubImport';
import { importNote } from './importTf';
import { shareLinkInfo } from './share';
import { createProject, duplicateProject, openDemoProject, StorageFullError } from './storage';
import { pageTitle } from './useDocumentTitle';
import { slugify, timeAgo } from './utils';

// (node: no localStorage — projects live in storage's in-memory fallback)
beforeEach(() => useLocale.getState().setLocale('pt-BR'));
afterEach(() => {
  useLocale.getState().setLocale('en');
  vi.unstubAllGlobals();
});

describe('lib text in Portuguese', () => {
  it('names copies, the demo and errors in the UI language', () => {
    const source = createProject({ name: 'web', files: { 'main.tf': '' } });
    expect(duplicateProject(source.id)!.name).toBe('web (cópia)');
    expect(openDemoProject().description).toMatch(/^Projeto de demonstração — /);
    expect(new StorageFullError().message).toBe('O armazenamento está cheio — exporte ou exclua projetos');
  });

  it('page titles, relative times and slugs', () => {
    expect(pageTitle('Projetos')).toBe('Projetos — Cloud Blueprint');
    expect(pageTitle(null)).toBe('Cloud Blueprint — Desenhe sua nuvem. Gere o Terraform na hora.');
    expect(timeAgo(new Date().toISOString())).toBe('agora');
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('há 3 horas');
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000).toISOString(), 'en')).toBe('3h ago');
    // a translated template name becomes a clean slug
    expect(slugify('Site estático no Azure')).toBe('site-estatico-no-azure');
  });

  it('import notes and share-link warnings', () => {
    expect(importNote({ name: 'x', files: {}, rootDir: 'infra', skipped: 2, oversized: 1 })).toBe(
      'Módulo raiz importado (infra/); 2 outros arquivos ficaram de fora. 1 arquivo era grande demais para importar.',
    );
    expect(importNote({ name: 'x', files: {}, rootDir: '', skipped: 1, oversized: 0, modules: ['modules/a', 'modules/b', 'modules/c'] })).toBe(
      'Módulo raiz importado com 3 módulos filhos; 1 outro arquivo ficou de fora.',
    );
    expect(importNote({ name: 'x', files: {}, rootDir: 'infra', skipped: 2, oversized: 0 }, { linkedFolder: true })).toBe(
      'Módulo raiz aberto (infra/); 2 arquivos em outras pastas não são sincronizados (o vínculo com a pasta mantém só o módulo raiz).',
    );
    vi.stubGlobal('location', { origin: 'https://example.test' });
    const big = shareLinkInfo({ name: 'big', files: { 'main.tf': Array.from({ length: 4000 }, (_, i) => `# ${i} ${Math.random()}`).join('\n') } });
    expect(big.warning).toMatch(/^Este link tem [\d.]+ KB — links acima de 32 KB podem ser cortados/);
  });

  it('backup checks, and the README inside the zip', () => {
    expect(validateManifest(null)).toEqual({ ok: false, error: 'Este arquivo não é um backup do Cloud Blueprint.' });
    expect(parseBackup(zipSync({ 'infra/main.tf': strToU8('resource "aws_vpc" "x" {}') }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/é uma exportação, não um backup\. Use “Importar \.tf”/),
    });
    const project = createProject({ name: 'web', files: { 'main.tf': '# web\n' } });
    const readme = new TextDecoder().decode(unzipSync(buildBackup([project]))['README.md']);
    expect(readme).toMatch(/^# Backup do Cloud Blueprint\n\n1 projeto, exportado em /);
    expect(readme).toContain('Projetos → **Restaurar backup…**');
  });

  it('the README of an exported Terraform zip', async () => {
    let blob: Blob | null = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => {
      blob = b;
      return 'blob:x';
    };
    // just enough DOM for the download link
    const link = { click() {}, remove() {} };
    Object.assign(globalThis, { document: { createElement: () => link, body: { appendChild() {} } } });
    try {
      exportZip('web', { 'main.tf': 'resource "aws_vpc" "x" {}\n' });
    } finally {
      URL.createObjectURL = original;
      delete (globalThis as { document?: unknown }).document;
    }
    const files = unzipSync(new Uint8Array(await blob!.arrayBuffer()));
    const readme = new TextDecoder().decode(files['README.md']);
    expect(readme).toContain('Projeto Terraform exportado do [Cloud Blueprint]');
    expect(readme).toContain('## Como usar');
    expect(readme).toContain('- `main.tf`');
  });

  it('GitHub import: link errors, sizes and times', () => {
    const bad = parseGithubInput('https://gitlab.com/acme/infra');
    expect(bad).toEqual({
      ok: false,
      error: 'Por enquanto só o GitHub é suportado — baixe os arquivos e solte-os no painel inicial.',
    });
    expect(parseGithubInput('')).toMatchObject({ ok: false, error: expect.stringMatching(/^Cole owner\/repo, um link do github\.com/) });
    expect(githubBytes(1.4 * 1024 * 1024)).toBe('1,4 MB');
    expect(githubBytes(1.4 * 1024 * 1024, 'en')).toBe('1.4 MB');
    const at = new Date(2026, 8, 29, 14, 5).getTime();
    expect(resetTime({ limit: 60, remaining: 0, resetAt: at })).toBe('14:05');
  });

  it('folder sync problems read in the language picked later', () => {
    expect(folderProblemText({ kind: 'missing' })).toBe('A pasta foi movida, renomeada ou excluída');
    expect(folderProblemText({ kind: 'missing' }, 'en')).toBe('The folder was moved, renamed or deleted');
    expect(folderProblemText({ kind: 'other', detail: 'Boom' })).toBe('Boom');
  });
});
