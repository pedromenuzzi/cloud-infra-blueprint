import { strToU8, zipSync } from 'fflate';
import { slugify } from './utils';

function terraformReadme(name: string, files: string[]): string {
  return `# ${name}

Terraform project exported from [Cloud Blueprint](https://github.com/cloud-blueprint) —
the free, in-browser visual editor for cloud architecture.

## Files

${files.map((f) => `- \`${f}\``).join('\n')}

## Usage

\`\`\`bash
terraform init
terraform plan
terraform apply
\`\`\`

> Review variables (e.g. passwords marked \`sensitive\`) before applying.
`;
}

export function exportZip(name: string, files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  const names = Object.keys(files).filter((f) => files[f].trim().length > 0);
  for (const file of names) entries[file] = strToU8(files[file]);
  entries['README.md'] = strToU8(terraformReadme(name, names));

  const zipped = zipSync(entries, { level: 6 });
  const blob = new Blob([zipped.slice().buffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(name)}-terraform.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
