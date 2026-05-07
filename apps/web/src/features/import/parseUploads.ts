import { parse, type Hcl2JsonAdapter } from '@blueprint/hcl';
import { applyPatch, emptyIR, type IR } from '@blueprint/ir';
import JSZip from 'jszip';

import { applyAutoLayout } from './layout';
import { looksLikeTerraformState, tfstateToIR, type TerraformStateFile } from './tfstate';

export type ImportSourceKind = 'hcl' | 'tfstate' | 'zip';

export interface ImportFileResult {
  /** Display path (`vpc.tf`, `nested/network.tf`). */
  filename: string;
  kind: ImportSourceKind;
  bytes: number;
  /** Parser-level error (file rejected) — `undefined` when the file parsed. */
  error?: string;
}

export interface ImportResult {
  ir: IR;
  files: ImportFileResult[];
  /** Summary stats so the route can print "12 resources, 5 edges, 3 files". */
  totals: {
    files: number;
    resources: number;
    modules: number;
    edges: number;
    failed: number;
  };
}

/**
 * Hard cap on bytes read from a single uploaded file.
 *
 * Terraform projects are tiny by web standards — even fat ones (200+
 * resources) clock in well under 1 MB of source. We refuse anything past
 * 5 MB so a malicious upload can't OOM the worker; the dropzone surfaces
 * the rejection in the per-file list.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Files inside a zip whose paths contain any of these segments are skipped. */
const SKIP_PATH_SEGMENTS = ['/.git/', '/node_modules/', '/.terraform/', '/__MACOSX/'];

const HCL_SUFFIXES = ['.tf', '.tf.json'];
const STATE_SUFFIXES = ['.tfstate', '.tfstate.backup'];

function classifyByName(name: string): ImportSourceKind | null {
  const lower = name.toLowerCase();
  if (HCL_SUFFIXES.some((s) => lower.endsWith(s))) return 'hcl';
  if (STATE_SUFFIXES.some((s) => lower.endsWith(s))) return 'tfstate';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

/**
 * Read every supported file from `files`, parse each one in the worker
 * (HCL) or directly (state JSON), merge the resulting IRs, and apply
 * dagre auto-layout.
 *
 * The function is intentionally side-effect-free: it doesn't touch the
 * Zustand store. The route component owns the "did the user confirm?"
 * step and the actual `setIR` / `navigate` decisions.
 */
export async function parseUploads(files: File[], adapter: Hcl2JsonAdapter): Promise<ImportResult> {
  const collected = await collectAllFiles(files);
  return parseCollected(collected, adapter);
}

interface CollectedFile {
  filename: string;
  bytes: number;
  text: string;
  kind: ImportSourceKind | 'reject';
  rejection?: string;
}

async function collectAllFiles(files: File[]): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      out.push({
        filename: file.name,
        bytes: file.size,
        text: '',
        kind: 'reject',
        rejection: `File exceeds ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
      });
      continue;
    }
    const kind = classifyByName(file.name);
    if (!kind) {
      out.push({
        filename: file.name,
        bytes: file.size,
        text: '',
        kind: 'reject',
        rejection: 'Unsupported file type — accepts .tf, .tfstate, .zip.',
      });
      continue;
    }
    if (kind === 'zip') {
      try {
        const expanded = await expandZip(file);
        out.push(...expanded);
      } catch (err) {
        out.push({
          filename: file.name,
          bytes: file.size,
          text: '',
          kind: 'reject',
          rejection: `Failed to read zip: ${(err as Error).message}.`,
        });
      }
      continue;
    }
    out.push({
      filename: file.name,
      bytes: file.size,
      text: await file.text(),
      kind,
    });
  }
  return out;
}

async function expandZip(file: File): Promise<CollectedFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const out: CollectedFile[] = [];
  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) return;
      const path = `/${entry.name}`;
      if (SKIP_PATH_SEGMENTS.some((seg) => path.includes(seg))) return;
      const kind = classifyByName(entry.name);
      if (!kind || kind === 'zip') return;
      const text = await entry.async('string');
      if (text.length > MAX_FILE_BYTES) {
        out.push({
          filename: entry.name,
          bytes: text.length,
          text: '',
          kind: 'reject',
          rejection: `File exceeds ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
        });
        return;
      }
      out.push({ filename: entry.name, bytes: text.length, text, kind });
    }),
  );
  return out;
}

async function parseCollected(
  collected: CollectedFile[],
  adapter: Hcl2JsonAdapter,
): Promise<ImportResult> {
  const fileResults: ImportFileResult[] = [];
  let merged: IR = emptyIR();

  const hclFiles: Record<string, string> = {};

  for (const item of collected) {
    if (item.kind === 'reject') {
      fileResults.push({
        filename: item.filename,
        kind: 'hcl',
        bytes: item.bytes,
        error: item.rejection,
      });
      continue;
    }
    if (item.kind === 'tfstate') {
      try {
        const parsed = JSON.parse(item.text) as unknown;
        if (!looksLikeTerraformState(parsed)) {
          throw new Error('JSON does not look like a Terraform state file.');
        }
        const ir = tfstateToIR(parsed as TerraformStateFile);
        merged = mergeIR(merged, ir);
        fileResults.push({ filename: item.filename, kind: 'tfstate', bytes: item.bytes });
      } catch (err) {
        fileResults.push({
          filename: item.filename,
          kind: 'tfstate',
          bytes: item.bytes,
          error: (err as Error).message,
        });
      }
      continue;
    }
    hclFiles[item.filename] = item.text;
  }

  if (Object.keys(hclFiles).length > 0) {
    try {
      const ir = await parse(hclFiles, adapter);
      merged = mergeIR(merged, ir);
      for (const filename of Object.keys(hclFiles)) {
        fileResults.push({
          filename,
          kind: 'hcl',
          bytes: hclFiles[filename]?.length ?? 0,
        });
      }
    } catch (err) {
      const message = (err as Error).message;
      for (const filename of Object.keys(hclFiles)) {
        fileResults.push({
          filename,
          kind: 'hcl',
          bytes: hclFiles[filename]?.length ?? 0,
          error: message,
        });
      }
    }
  }

  const laidOut = applyAutoLayout(merged);

  return {
    ir: laidOut,
    files: fileResults,
    totals: {
      files: fileResults.length,
      resources: laidOut.resources.length,
      modules: laidOut.modules.length,
      edges: laidOut.edges.length,
      failed: fileResults.filter((f) => f.error).length,
    },
  };
}

/**
 * Merge two IRs by applying everything from `b` as a single `IRPatch`
 * against `a`.
 *
 * Going through `applyPatch` (instead of spreading the arrays) keeps the
 * IR invariants the same as if the user had imported each block via the
 * canvas: variables / outputs / providers come along, modules are kept,
 * and edges go through the same validation as canvas-drawn ones.
 */
function mergeIR(a: IR, b: IR): IR {
  return applyPatch(a, {
    addResources: b.resources,
    addModules: b.modules,
    addEdges: b.edges,
    setVariables: b.variables,
    setOutputs: b.outputs,
    setProviders: b.providers,
  });
}
