/**
 * The code pane's own words and what the catalog-aware completion and hover
 * add to Monaco (monaco/setup.ts). Monaco's built-in widgets (find, the
 * context menu) keep their English: they only localize at load time.
 */
import { defineMessages } from '@/i18n/messages';
import { categoryLabel } from '@/resources/i18n';
import type { Category } from '@/resources/types';

export const codeMessages = defineMessages(
  {
    terraformCode: 'Terraform code',
    files: 'Files',
    /** the status bar's caret position */
    position: (line: number, col: number) => `Ln ${line}, Col ${col}`,
    loading: 'Loading code editor…',
    /* completion and hover */
    resourceSnippet: 'res: resource block',
    dataSnippet: 'data: data block',
    required: ' · required',
    hoverMeta: (category: Category, provider: string) => `Category: ${category} · Provider: ${provider}`,
    moduleOutput: (dir: string) => `output of ${dir}`,
  },
  {
    terraformCode: 'Código Terraform',
    files: 'Arquivos',
    position: (line: number, col: number) => `Ln ${line}, Col ${col}`,
    loading: 'Carregando o editor de código…',
    resourceSnippet: 'res: bloco resource',
    dataSnippet: 'data: bloco data',
    required: ' · obrigatório',
    hoverMeta: (category: Category, provider: string) =>
      `Categoria: ${categoryLabel(category, 'pt-BR')} · Provider: ${provider}`,
    moduleOutput: (dir: string) => `output de ${dir}`,
  },
);
