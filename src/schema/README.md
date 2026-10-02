# Provider schemas

`data/{aws,azurerm,google}.json` are the real Terraform provider schemas, trimmed for the
browser. The editor uses them for the inspector's **All arguments** section, Monaco
completion and hover, and validation. Each file is its own lazy chunk: it loads only when the
project holds (or the inspector opens) a resource of that provider. Nothing is fetched at
runtime from anywhere else.

`data/{aws,azurerm,google}.data.json` are the same providers' **data sources**, in the same
format (`"kind": "data"`, data source types in `resources`). Each is a lazy chunk of its own,
loaded only when the project holds a `data` block of that provider (or Monaco asks after
`data "` / `data.aws_x.name.`), so projects without data blocks never fetch them. They drive
the data block inspector, completion and hover inside `data` blocks, what
`data.type.name.` offers, and validation (unknown or read-only arguments, missing required
ones, attributes a data source doesn't expose).

| file | provider | types | raw | gzip chunk |
| --- | --- | --- | --- | --- |
| `aws.json` | hashicorp/aws 6.66.0 (`~> 6.0`) | 1725 resources, all of them | 1390 KB | ~200 KB |
| `azurerm.json` | hashicorp/azurerm 5.7.0 (`~> 5.0`) | 1105 resources, all of them | 719 KB | ~108 KB |
| `google.json` | hashicorp/google 8.4.0 (`~> 8.0`) | 1367 resources, all of them | 1594 KB | ~290 KB |
| `aws.data.json` | hashicorp/aws 6.66.0 | 683 data sources, all of them | 1056 KB | ~77 KB |
| `azurerm.data.json` | hashicorp/azurerm 5.7.0 | 395 data sources, all of them | 265 KB | ~36 KB |
| `google.data.json` | hashicorp/google 8.4.0 | 468 data sources, all of them | 325 KB | ~43 KB |

## What's kept

- Every resource type, so completion and validation have no gaps.
- Per attribute: its Terraform type (`list(string)`), required / optional / computed,
  sensitive, deprecated with the provider's note when it has one, write-only, and a
  description cut to about 120 characters.
- Per nested block: nesting mode (single / list / set / map), min and max items,
  recursively.
- Computed (exported) attributes, for completion after `aws_x.name.`.
- Identical block bodies are stored once and shared by index. The WAFv2 and QuickSight
  statement trees alone would take about 6 MB otherwise.
- Help text is dropped for read-only attributes inside nested blocks. Google documents
  about 12× more text than AWS, so to stay under the 300 KB gzip budget only the palette
  types and the common services in `popular.ts` keep their descriptions. The long tail
  ships as structure only.

- Data sources keep the same per-attribute data, but help text only for what one writes
  (arguments and nested blocks); the attributes a data source only exposes ship as name
  and type. Google's long tail of data sources (derived from its resources, repeating
  their help) ships structure only: `DATA_SOURCES_WITH_HELP` in `popular.ts` keep theirs.

`schema.test.ts` fails when a chunk goes over 300 KB gzip, `dataSources.test.ts` when a data
chunk goes over 120 KB. The format is described in `types.ts`.

## Refreshing (after a provider bump)

The version pins come from `src/templates/index.ts`, so bump them there first. Then run:

```sh
# needs terraform ≥ 1.1 and network (or a warm plugin cache)
TF_PLUGIN_CACHE_DIR=~/.terraform.d/plugin-cache pnpm schema:generate
pnpm test          # size budget, zero false positives on templates and catalog
```

For each provider, the generator writes a scratch project with that pin. It then runs
`terraform init` and `terraform providers schema -json`, trims the output and writes
`data/<provider>.json` and `data/<provider>.data.json`. Each line holds one resource or one block, so the diff reads
well in review. Other options:

- `TERRAFORM=/path/to/terraform` picks the binary.
- `--provider aws` regenerates one provider only.
- `--from dump.json --lock .terraform.lock.hcl` trims an existing dump.

CI runs `pnpm schema:generate --check`. This regenerates at the versions recorded in the
files, not the latest ones, and fails if the output differs from what is committed. A new
upstream release never breaks the build; refreshing is a deliberate commit.

When a project pins a range that excludes the shipped version (say, an imported
`~> 5.0` AWS project), schema warnings are turned off for that provider. The inspector
says so, and completion keeps working.
