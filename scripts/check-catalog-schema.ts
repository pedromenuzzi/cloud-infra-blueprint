/**
 * Check the resource catalog against the real provider schemas: every field
 * exists with a compatible type, `required` matches the schema, schema-required
 * arguments and nested blocks are covered by a field or a default, and every
 * refAttr / connection attribute is exported by the target type.
 *
 *   terraform providers schema -json > schema.json
 *   pnpm exec vite-node scripts/check-catalog-schema.ts schema.json
 *
 * Exits 1 when anything is off, so CI catches catalog drift on provider bumps.
 */
import { readFileSync } from 'node:fs';
import type { Expression } from '@/ir/types';
import { providerSourceName } from '@/ir/types';
import { allDefs, getDef } from '@/resources/registry';
import type { FieldDef, ResourceDef } from '@/resources/types';

interface SchemaAttr {
  type?: unknown;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  deprecated?: boolean;
}
interface SchemaBlock {
  attributes?: Record<string, SchemaAttr>;
  block_types?: Record<string, { nesting_mode: string; block: SchemaBlock; min_items?: number; max_items?: number }>;
  deprecated?: boolean;
}
interface ProviderSchemas {
  provider_schemas: Record<string, { resource_schemas: Record<string, { block: SchemaBlock }> }>;
}

const schemaFile = process.argv[2];
if (!schemaFile) {
  process.stderr.write('usage: check-catalog-schema.ts <terraform providers schema -json output>\n');
  process.exit(2);
}
const schemas = JSON.parse(readFileSync(schemaFile, 'utf8')) as ProviderSchemas;

function resourceSchema(type: string): SchemaBlock | undefined {
  const def = getDef(type);
  const source = def ? providerSourceName(def.provider) : type.split('_')[0];
  return schemas.provider_schemas[`registry.terraform.io/hashicorp/${source}`]?.resource_schemas[type]?.block;
}

function typeMatches(field: FieldDef, type: unknown): boolean {
  const kind = Array.isArray(type) ? type[0] : type;
  switch (field.type) {
    case 'string':
    case 'select':
      return kind === 'string';
    case 'number':
      return kind === 'number';
    case 'boolean':
      return kind === 'bool';
    case 'tags':
      return kind === 'map';
    case 'list':
      return kind === 'list' || kind === 'set';
  }
}

/**
 * Optional in the schema, but `terraform validate` requires one of a group
 * (ExactlyOneOf / AtLeastOneOf, which the JSON schema doesn't carry) — the
 * catalog flags the usual member as required.
 */
const ONE_OF_REQUIRED = new Set([
  // one of administrator_login_password(_wo) or an Entra-only azuread_administrator
  'azurerm_mssql_server.administrator_login_password',
]);

const problems: string[] = [];
const report = (def: ResourceDef, message: string) => problems.push(`${def.type}: ${message}`);

/** nested default blocks: every key known, required attributes and blocks present */
function checkBlock(def: ResourceDef, path: string, body: Record<string, Expression>, schema: SchemaBlock) {
  for (const [k, v] of Object.entries(body)) {
    const attr = schema.attributes?.[k];
    const nested = schema.block_types?.[k];
    if (!attr && !nested) report(def, `default ${path}${k} is not in the schema`);
    if (attr?.deprecated) report(def, `default ${path}${k} is deprecated`);
    if (nested && (v.kind === 'block' || v.kind === 'blocks')) {
      const items = v.kind === 'block' ? [v.body] : v.items;
      for (const item of items) checkBlock(def, `${path}${k}.`, item, nested.block);
    }
  }
  for (const [k, attr] of Object.entries(schema.attributes ?? {})) {
    const connected = def.blockConnections?.some((c) => `${c.block}.` === path && c.arg === k);
    if (attr.required && !body[k] && path && !connected) {
      report(def, `default block ${path.slice(0, -1)} lacks required "${k}"`);
    }
  }
  for (const [k, b] of Object.entries(schema.block_types ?? {})) {
    if ((b.min_items ?? 0) > 0 && !body[k] && path) report(def, `default block ${path.slice(0, -1)} lacks required block "${k}"`);
  }
}

for (const def of allDefs()) {
  const schema = resourceSchema(def.type);
  if (!schema) {
    report(def, 'resource type is not in the provider schema');
    continue;
  }
  if (schema.deprecated) report(def, 'resource type is deprecated');
  const attrs = schema.attributes ?? {};
  const blockTypes = schema.block_types ?? {};
  const defaults = def.defaults ?? {};
  const fieldNames = new Set(def.fields.map((f) => f.name));

  for (const field of def.fields) {
    const attr = attrs[field.name];
    if (!attr) {
      report(def, `field "${field.name}" is not an attribute in the schema`);
      continue;
    }
    if (attr.deprecated) report(def, `field "${field.name}" is deprecated`);
    if (!typeMatches(field, attr.type)) {
      report(def, `field "${field.name}" is ${field.type} but the schema type is ${JSON.stringify(attr.type)}`);
    }
    const oneOf = ONE_OF_REQUIRED.has(`${def.type}.${field.name}`);
    if (!!field.required !== !!attr.required && !(oneOf && field.required)) {
      report(def, `field "${field.name}" required=${!!field.required} but the schema says ${attr.required ? 'required' : 'optional'}`);
    }
    for (const target of field.refTo ?? []) {
      const attrName = field.refAttr ?? 'id';
      const targetSchema = resourceSchema(target);
      if (targetSchema && !targetSchema.attributes?.[attrName]) {
        report(def, `field "${field.name}" refAttr ${target}.${attrName} does not exist`);
      }
    }
  }

  for (const rule of [...(def.connections ?? []), ...(def.blockConnections ?? [])]) {
    for (const target of rule.targetTypes) {
      const targetSchema = resourceSchema(target);
      if (targetSchema && !targetSchema.attributes?.[rule.attr]) {
        report(def, `connection to ${target} uses missing attribute "${rule.attr}"`);
      }
    }
  }

  for (const [name, attr] of Object.entries(attrs)) {
    if (!attr.required) continue;
    if (!fieldNames.has(name) && !defaults[name]) report(def, `schema-required "${name}" has no field and no default`);
  }
  for (const [name, b] of Object.entries(blockTypes)) {
    if ((b.min_items ?? 0) > 0 && !defaults[name]) report(def, `schema-required block "${name}" has no default`);
  }
  checkBlock(def, '', defaults, schema);
}

if (problems.length) {
  process.stdout.write(`${problems.join('\n')}\n\n${problems.length} catalog/schema mismatches\n`);
  process.exit(1);
}
process.stdout.write(`Catalog matches the provider schemas (${allDefs().length} resources)\n`);
