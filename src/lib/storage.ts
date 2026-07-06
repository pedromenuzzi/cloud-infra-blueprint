/**
 * Local-first persistence: projects live in localStorage. No account, no
 * server — the free tier is the whole product. (A future sync backend slots
 * in behind this same interface.)
 */
import type { Provider } from '@/ir/types';
import { getTemplate } from '@/templates';
import { uid } from './utils';

export interface Project {
  id: string;
  name: string;
  description?: string;
  files: Record<string, string>;
  providers: Provider[];
  templateSlug?: string;
  createdAt: string;
  updatedAt: string;
}

const KEY = 'cb-projects-v1';
const SEED_KEY = 'cb-seeded-v1';

function readAll(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(projects: Project[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    /* quota / private mode — the editor keeps working in memory */
  }
}

export function detectProviders(files: Record<string, string>): Provider[] {
  const text = Object.values(files).join('\n');
  const out: Provider[] = [];
  if (/\b(?:resource|data)\s+"aws_/.test(text) || /provider\s+"aws"/.test(text)) out.push('aws');
  if (/\b(?:resource|data)\s+"azurerm_/.test(text) || /provider\s+"azurerm"/.test(text)) {
    out.push('azure');
  }
  if (/\b(?:resource|data)\s+"google_/.test(text) || /provider\s+"google"/.test(text)) {
    out.push('gcp');
  }
  return out;
}

export function listProjects(): Project[] {
  return readAll().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getProject(id: string): Project | undefined {
  return readAll().find((p) => p.id === id);
}

export function createProject(input: {
  name: string;
  files: Record<string, string>;
  description?: string;
  templateSlug?: string;
}): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: uid('prj'),
    name: input.name,
    description: input.description,
    files: input.files,
    providers: detectProviders(input.files),
    templateSlug: input.templateSlug,
    createdAt: now,
    updatedAt: now,
  };
  writeAll([project, ...readAll()]);
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'files'>>,
): Project | undefined {
  const all = readAll();
  const i = all.findIndex((p) => p.id === id);
  if (i === -1) return undefined;
  const next: Project = {
    ...all[i],
    ...patch,
    providers: patch.files ? detectProviders(patch.files) : all[i].providers,
    updatedAt: new Date().toISOString(),
  };
  all[i] = next;
  writeAll(all);
  return next;
}

export function deleteProject(id: string) {
  writeAll(readAll().filter((p) => p.id !== id));
}

export function duplicateProject(id: string): Project | undefined {
  const source = getProject(id);
  if (!source) return undefined;
  return createProject({
    name: `${source.name} copy`,
    files: { ...source.files },
    description: source.description,
    templateSlug: source.templateSlug,
  });
}

/** First visit: seed a demo project so the dashboard tells a story. */
export function ensureSeed() {
  try {
    if (localStorage.getItem(SEED_KEY)) return;
    localStorage.setItem(SEED_KEY, '1');
  } catch {
    return;
  }
  if (readAll().length > 0) return;
  const template = getTemplate('aws-web-app');
  if (!template) return;
  createProject({
    name: 'production-web',
    description: 'Demo project — a classic VPC + EC2 + RDS web stack. Safe to edit or delete.',
    files: template.build('production-web'),
    templateSlug: template.slug,
  });
}
