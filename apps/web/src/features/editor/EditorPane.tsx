import { cn } from '@blueprint/ui';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

interface EditorPaneProps {
  className?: string;
}

interface FileTab {
  id: string;
  /** Synthesized HCL preview shown until F3 mounts Monaco. */
  body: string;
}

const FILES: FileTab[] = [
  {
    id: 'main.tf',
    body: `# HCL highlights
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags       = { Name = "production-vpc" }
}

resource "aws_subnet" "public_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "public_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_instance" "web" {
  ami           = "ami-0abc1234"
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.public_a.id
  tags          = { Name = "web-server" }
}

// the connection to the rds instance below
module "subnet_a" {
  source = "./modules/subnet"
}
`,
  },
  {
    id: 'variables.tf',
    body: `variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}
`,
  },
  {
    id: 'outputs.tf',
    body: `output "web_url" {
  value = aws_instance.web.public_ip
}
`,
  },
  {
    id: 'providers.tf',
    body: `terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}
`,
  },
];

/**
 * HCL editor pane — image 01 reference. Multiple file tabs with a "+" to add
 * files, a syntax-highlighted preview body and a status bar at the bottom
 * (HCL · UTF-8 · Ln/Col). F3 swaps the body for a real Monaco instance bound
 * to the shared `Y.Text`.
 */
export function EditorPane({ className }: EditorPaneProps) {
  const [activeId, setActiveId] = useState(FILES[0]?.id ?? 'main.tf');
  const active = FILES.find((f) => f.id === activeId) ?? FILES[0];

  return (
    <section className={cn('flex flex-col bg-card', className)} aria-label="HCL editor">
      <FileTabs files={FILES} activeId={activeId} onSelect={setActiveId} />
      <CodeBody body={active?.body ?? ''} />
      <StatusBar fileId={activeId} />
    </section>
  );
}

function FileTabs({
  files,
  activeId,
  onSelect,
}: {
  files: FileTab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-9 items-stretch border-b border-border/60 bg-surface-1">
      {files.map((f) => {
        const isActive = f.id === activeId;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            className={cn(
              'group relative flex items-center gap-2 border-r border-border/60 px-3 text-xs font-medium transition-colors',
              isActive
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            <span className="font-mono">{f.id}</span>
            {isActive && (
              <span className="absolute inset-x-0 -top-px h-0.5 bg-primary" aria-hidden />
            )}
            <X className="invisible h-3 w-3 opacity-0 transition-opacity group-hover:visible group-hover:opacity-60" />
          </button>
        );
      })}
      <button
        type="button"
        aria-label="New file"
        className="focus-ring flex items-center justify-center px-3 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CodeBody({ body }: { body: string }) {
  return (
    <div className="relative flex-1 overflow-auto bg-card">
      <div className="grid min-h-full grid-cols-[3.25rem_1fr] gap-0">
        <pre
          aria-hidden
          className="select-none border-r border-border/40 bg-surface-1 px-2 py-3 text-right text-[11px] leading-[1.55] text-muted-foreground/70"
        >
          <code className="font-mono">
            {Array.from({ length: lineCount(body) })
              .map((_, i) => `${i + 1}\n`)
              .join('')}
          </code>
        </pre>
        <pre className="overflow-auto px-3 py-3 text-[12.5px] leading-[1.55]">
          <code className="font-mono">{highlight(body)}</code>
        </pre>
      </div>
    </div>
  );
}

function StatusBar({ fileId }: { fileId: string }) {
  return (
    <div className="flex h-7 items-center justify-between border-t border-border/60 bg-surface-1 px-3 text-[11px] font-medium text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="font-mono">{fileId}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>HCL</span>
        <span>UTF-8</span>
        <span>Ln 24, Col 8</span>
      </div>
    </div>
  );
}

function lineCount(s: string): number {
  let count = 1;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') count++;
  return count;
}

/* -------------------------------------------------------------------------- */
/* Tiny HCL syntax highlighter (regex-based, F3 replaces with Monaco).        */
/* -------------------------------------------------------------------------- */

type Token = { kind: keyof typeof TOKEN_CLASS | 'plain'; text: string };

const TOKEN_CLASS = {
  comment: 'text-muted-foreground/80 italic',
  keyword: 'text-primary font-semibold',
  string: 'text-warning',
  ident: 'text-foreground',
  number: 'text-success',
} as const;

const KEYWORDS = new Set([
  'resource',
  'module',
  'variable',
  'output',
  'provider',
  'terraform',
  'data',
  'locals',
  'true',
  'false',
  'null',
]);

function highlight(source: string): React.ReactNode[] {
  const tokens = tokenize(source);
  return tokens.map((t, i) => {
    if (t.kind === 'plain') return t.text;
    return (
      <span key={i} className={TOKEN_CLASS[t.kind]}>
        {t.text}
      </span>
    );
  });
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    // Line comments — both `#` and `//`.
    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out.push({ kind: 'comment', text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    // Strings (no interpolation handling — F3 swap fixes that).
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j++;
        j++;
      }
      out.push({ kind: 'string', text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    // Identifiers / keywords.
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_-]/.test(src[j] ?? '')) j++;
      const word = src.slice(i, j);
      out.push({ kind: KEYWORDS.has(word) ? 'keyword' : 'plain', text: word });
      i = j;
      continue;
    }
    // Numbers.
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j] ?? '')) j++;
      out.push({ kind: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }
    out.push({ kind: 'plain', text: ch });
    i++;
  }
  return out;
}
