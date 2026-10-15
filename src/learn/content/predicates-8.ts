/**
 * Predicates the production lessons (level 8) need on top of ../goals.ts:
 * the `backend "s3"` block, `.tfvars` files, secrets left in the code and
 * outputs that carry them, `lifecycle` lists, `import {}` and `removed {}`
 * blocks, and what a plan against the current state would do. Blocks the IR
 * keeps verbatim (`terraform`, `import`, `removed`) are parsed here, so
 * layout, comments and argument order are the learner's.
 */
import { parseFile } from '@/hcl/parser';
import { collectRefs } from '@/ir/expr';
import type { Expression, IR } from '@/ir/types';
import { argAt, referencedAddresses, resourcesOf, valueOf } from '../goals';
import { evaluate, type Scope, type Val } from '../sim/eval';
import { simulate, type SimResult } from '../sim/simulate';
import type { Files, LessonCtx, SimState } from '../types';

type Test = (ctx: LessonCtx) => boolean;
type Body = Record<string, Expression>;

const COMMENTS = String.raw`(?:\s*(?:#|//)[^\n]*\n)*\s*`;
const header = (keyword: string) => new RegExp(`^${COMMENTS}${keyword}\\s*\\{`);
const TERRAFORM = header('terraform');
const IMPORT = header('import');
const REMOVED = header('removed');
const BACKEND_S3 = header('backend\\s*"s3"');

/** the body of a verbatim block whose header matches, parsed (null when it isn't one or doesn't parse) */
function bodyOf(text: string, head: RegExp): Body | null {
  const m = head.exec(text);
  if (!m) return null;
  const { blocks, errors } = parseFile('', `output "x" {${text.slice(m[0].length)}`);
  const [block] = blocks;
  return errors.length === 0 && block?.kind === 'labeled' ? block.args : null;
}

const bodies = (ctx: LessonCtx, head: RegExp): Body[] =>
  ctx.ir.extras.map((e) => bodyOf(e.text, head)).filter((b): b is Body => b !== null);

/** `aws_s3_bucket.logs`, `aws_s3_bucket.app["a"]`: an address as written, spaces out */
const addressIn = (e: Expression | undefined): string =>
  !e ? '' : e.kind === 'ref' ? e.path : e.kind === 'raw' ? e.hcl.replace(/\s+/g, '') : '';

const declared = (ir: IR, address: string) => ir.resources.some((r) => r.id === address.replace(/\[[^\]]*\]$/, ''));

const isTrue = (ir: IR, e: Expression | undefined) => valueOf(ir, e) === true;

/* ------------------------------------------------------------ backend */

/** the arguments of the `backend "s3"` block, if the code has one */
export function backendS3(ctx: LessonCtx): Body | null {
  for (const tf of bodies(ctx, TERRAFORM)) {
    for (const [key, e] of Object.entries(tf)) {
      if (!/^backend\s*"s3"/.test(key) || e.kind !== 'raw') continue;
      const body = bodyOf(e.hcl, BACKEND_S3);
      if (body) return body;
    }
  }
  return null;
}

/** a literal, non-empty string: a backend can't read variables (`Variables may not be used here`) */
const literalText = (e: Expression | undefined): string | undefined =>
  e?.kind === 'literal' && typeof e.value === 'string' && e.value.trim() !== '' ? e.value : undefined;

/** a `backend "s3"` block naming its `bucket`, `key` and `region` with plain strings */
export const backendS3Set: Test = (ctx) => {
  const b = backendS3(ctx);
  return b !== null && ['bucket', 'key', 'region'].every((k) => literalText(b[k]) !== undefined);
};

/** the backend sets `key` to `value` */
export const backendIs =
  (key: string, value: string | boolean): Test =>
  (ctx) => {
    const e = backendS3(ctx)?.[key];
    return e?.kind === 'literal' && e.value === value;
  };

/** state locking: `use_lockfile = true` (S3 itself, Terraform 1.10+) or the older `dynamodb_table` */
export const backendLocked: Test = (ctx) => {
  const b = backendS3(ctx);
  return b !== null && ((b.use_lockfile?.kind === 'literal' && b.use_lockfile.value === true) || literalText(b.dynamodb_table) !== undefined);
};

/** the backend keeps the state in a bucket this code declares (the bootstrap: the bucket holds its own state) */
export const backendOnOwnBucket: Test = (ctx) => {
  const bucket = literalText(backendS3(ctx)?.bucket);
  return backendS3Set(ctx) && resourcesOf(ctx, 'aws_s3_bucket').some((r) => valueOf(ctx.ir, r.args.bucket) === bucket);
};

/* ------------------------------------------------------------ variable files */

const NONE: Scope = { ref: () => undefined };

/** root `*.tfvars` files, each read as name → value (null: it doesn't parse) */
export function varFiles(files: Files): Map<string, Record<string, Val> | null> {
  const out = new Map<string, Record<string, Val> | null>();
  for (const [file, text] of Object.entries(files)) {
    if (file.includes('/') || !file.endsWith('.tfvars')) continue;
    const { blocks, errors } = parseFile(file, `output "tfvars" {\n${text}\n}\n`);
    const [block] = blocks;
    out.set(
      file,
      errors.length === 0 && block?.kind === 'labeled'
        ? Object.fromEntries(Object.entries(block.args).map(([k, e]) => [k, evaluate(e, NONE)]))
        : null,
    );
  }
  return out;
}

/** the values of the root `.tfvars` file named after `env` (`dev.tfvars`, `prod.tfvars`, `env-prod.tfvars`) */
function valuesFor(ctx: LessonCtx, env: string): Record<string, Val> | null {
  const named = [...varFiles(ctx.files)].filter(([file]) => file.toLowerCase().replace(/\.tfvars$/, '').includes(env));
  return named.length === 1 ? named[0][1] : null;
}

/**
 * A `.tfvars` file named after `env` that parses, sets at least `min`
 * variables (all declared: Terraform warns about the others) and names the
 * environment in one of its values (`environment = "prod"`).
 */
export const varFile =
  (env: string, min = 1): Test =>
  (ctx) => {
    const values = valuesFor(ctx, env);
    if (!values) return false;
    const names = Object.keys(values);
    const vars = new Set(ctx.ir.variables.map((v) => v.name));
    return (
      names.length >= min &&
      names.every((n) => vars.has(n)) &&
      Object.values(values).some((v) => typeof v === 'string' && v.toLowerCase().includes(env))
    );
  };

/** the `dev` and `prod` files set at least `min` of the same variables to different values */
export const varFilesDiffer =
  (min: number): Test =>
  (ctx) => {
    const dev = valuesFor(ctx, 'dev');
    const prod = valuesFor(ctx, 'prod');
    if (!dev || !prod) return false;
    return Object.keys(dev).filter((k) => k in prod && JSON.stringify(dev[k]) !== JSON.stringify(prod[k])).length >= min;
  };

/** the plain text of an expression's string parts (`${...}` taken out): what is typed, not computed */
function typedStrings(e: Expression): string[] {
  switch (e.kind) {
    case 'literal':
      return typeof e.value === 'string' ? [e.value] : [];
    case 'list':
      return e.items.flatMap(typedStrings);
    case 'object':
      return Object.values(e.fields).flatMap(typedStrings);
    case 'block':
      return Object.values(e.body).flatMap(typedStrings);
    case 'blocks':
      return e.items.flatMap((b) => Object.values(b).flatMap(typedStrings));
    case 'raw':
      return [...e.hcl.replace(/\$\{[^}]*\}/g, ' ').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    case 'ref':
      return [];
  }
}

/** no resource argument has text matching `pattern` typed in it (`"acme-dev-uploads"`, `Environment = "dev"`) */
export const noneTyped =
  (pattern: RegExp): Test =>
  (ctx) =>
    ctx.ir.resources.every((r) => Object.entries(r.args).every(([k, e]) => k === 'lifecycle' || !typedStrings(e).some((s) => pattern.test(s))));

/** a variable whose name says it holds the environment (`environment`, `env`, `stage`), used in the code */
export const environmentVariable: Test = (ctx) =>
  ctx.ir.variables.some(
    (v) => /env|stage/i.test(v.name) && Object.entries(ctx.files).some(([f, t]) => !f.includes('/') && f.endsWith('.tf') && new RegExp(`\\bvar\\.${v.name}\\b`).test(t)),
  );

/* ------------------------------------------------------------ secrets */

/** argument names that hold a secret (`password`, `master_password`, `api_key`), not ones about it (`manage_master_user_password`) */
const SECRET_ARG = /(^|_)(password|secret|token|api_key)$/i;
/** variable and tfvars names that sound like a secret */
const SECRET_NAME = /pass(word)?|secret|token|api_?key/i;

const typedSecret = (e: Expression | undefined) => e?.kind === 'literal' && typeof e.value === 'string' && e.value !== '';

/**
 * No secret typed into the code: no secret-sounding variable with a default,
 * no secret argument set to a plain string, none in a `.tfvars` file (they
 * end up in git just the same).
 */
export const noSecretsInCode: Test = (ctx) =>
  !ctx.ir.variables.some((v) => SECRET_NAME.test(v.name) && typedSecret(v.args.default)) &&
  !ctx.ir.resources.some((r) => Object.entries(r.args).some(([k, e]) => SECRET_ARG.test(k) && typedSecret(e))) &&
  ![...varFiles(ctx.files).values()].some((values) => values !== null && Object.keys(values).some((k) => SECRET_NAME.test(k)));

/** some `type` (a database) lets AWS keep its master password: `manage_master_user_password = true`, no `password` */
export const managesPassword =
  (type: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => isTrue(ctx.ir, r.args.manage_master_user_password) && r.args.password === undefined);

/** what Terraform treats as sensitive: a sensitive variable, a parameter or secret read from AWS, a password */
function readsSecret(ir: IR, e: Expression): boolean {
  const refs: Array<{ field: string; path: string }> = [];
  collectRefs(e, '', refs);
  return refs.some(({ path }) => {
    const variable = /^var\.([\w-]+)/.exec(path)?.[1];
    if (variable) return ir.variables.some((v) => v.name === variable && isTrue(ir, v.args.sensitive));
    return (
      /^data\.aws_ssm_parameter\.[\w-]+(\[[^\]]*\])?\.value\b/.test(path) ||
      /^data\.aws_secretsmanager_secret_version\.[\w-]+(\[[^\]]*\])?\.secret_(string|binary)\b/.test(path) ||
      /^random_password\.[\w-]+(\[[^\]]*\])?\.result\b/.test(path) ||
      /\.password$/.test(path)
    );
  });
}

/** some output carries a secret, and every output that does is marked `sensitive = true` */
export const secretOutputsSensitive: Test = (ctx) => {
  const carrying = ctx.ir.outputs.filter((o) => o.args.value !== undefined && readsSecret(ctx.ir, o.args.value));
  return carrying.length > 0 && carrying.every((o) => isTrue(ctx.ir, o.args.sensitive));
};

/** a secret read from AWS (`data "aws_ssm_parameter"`, `data "aws_secretsmanager_secret_version"`) that an output or a resource uses */
export const secretFromAws: Test = (ctx) => {
  const vaults = ctx.ir.data.filter((d) => d.type === 'aws_ssm_parameter' || d.type === 'aws_secretsmanager_secret_version').map((d) => d.id);
  const used = [...ctx.ir.outputs, ...ctx.ir.resources].flatMap((n) => Object.values(n.args).flatMap(referencedAddresses));
  // a data reference comes back whole: `data.aws_ssm_parameter.key.value`
  return vaults.some((id) => used.some((a) => a === id || a.startsWith(`${id}.`) || a.startsWith(`${id}[`)));
};

/* ------------------------------------------------------------ lifecycle */

/** some resource of `type` lists `attr` in `lifecycle { ignore_changes }` (or ignores `all`) */
export const ignores =
  (type: string, attr: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const e = argAt(r, 'lifecycle.ignore_changes');
      if ((e?.kind === 'raw' && e.hcl.trim() === 'all') || (e?.kind === 'ref' && e.path === 'all')) return true;
      return e?.kind === 'list' && e.items.some((i) => (i.kind === 'ref' ? i.path : i.kind === 'literal' ? String(i.value) : '') === attr);
    });

/* ------------------------------------------------------------ import and removed */

interface ImportStatement {
  to: string;
  id?: Val;
}

export const importsOf = (ctx: LessonCtx): ImportStatement[] =>
  bodies(ctx, IMPORT).map((b) => ({ to: addressIn(b.to), id: valueOf(ctx.ir, b.id) }));

/**
 * An `import` block adopting a resource of `type` the code declares, by an
 * id that matches what the resource says (`bucket` for a bucket, when given).
 */
export const importsInto =
  (type: string, idArg?: string): Test =>
  (ctx) =>
    importsOf(ctx).some((i) => {
      const r = ctx.ir.resources.find((x) => x.id === i.to.replace(/\[[^\]]*\]$/, ''));
      if (r?.type !== type || typeof i.id !== 'string' || i.id === '') return false;
      return idArg === undefined || valueOf(ctx.ir, r.args[idArg]) === i.id;
    });

/** the state holds every resource an `import` block names (and there is one) */
export const importsApplied: Test = (ctx) => {
  const imports = importsOf(ctx);
  return ctx.state !== null && imports.length > 0 && imports.every((i) => i.to in ctx.state!.resources);
};

const removedOf = (ctx: LessonCtx) =>
  bodies(ctx, REMOVED).map((b) => ({ from: addressIn(b.from), destroy: valueOf(ctx.ir, argAt({ args: b }, 'lifecycle.destroy')) }));

/** a `removed` block for something the code no longer declares, with `destroy = false`: forgotten, not deleted */
export const removedKeeps: Test = (ctx) => removedOf(ctx).some((r) => r.from !== '' && !declared(ctx.ir, r.from) && r.destroy === false);

/** the state no longer holds what `removed` blocks name (and there is one) */
export const removedGone: Test = (ctx) => {
  const removed = removedOf(ctx);
  const held = Object.keys(ctx.state?.resources ?? {});
  return ctx.state !== null && removed.length > 0 && removed.every((r) => !held.some((a) => a === r.from || a.startsWith(`${r.from}[`)));
};

/* ------------------------------------------------------------ the code and the state */

/** the code declares a resource at this address */
export const declares =
  (address: string): Test =>
  (ctx) =>
    declared(ctx.ir, address);

/** the state holds this address */
export const stateHolds =
  (address: string): Test =>
  (ctx) =>
    ctx.state !== null && address in ctx.state.resources;

/** some resource of `type` in the state has `attr` = `value` */
export const stateAttr =
  (type: string, attr: string, value: string | number | boolean): Test =>
  (ctx) =>
    ctx.state !== null &&
    Object.entries(ctx.state.resources).some(([a, attrs]) => a.replace(/\[[^\]]*\]$/, '').split('.').at(-2) === type && attrs[attr] === String(value));

/* ------------------------------------------------------------ the plan from here */

const planned = new WeakMap<Files, Map<SimState | null, SimResult>>();

/** what `terraform plan` says now: the code against the state of the last apply */
function planNow(ctx: LessonCtx): SimResult {
  let byState = planned.get(ctx.files);
  if (!byState) planned.set(ctx.files, (byState = new Map()));
  let result = byState.get(ctx.state);
  if (!result) byState.set(ctx.state, (result = simulate('plan', ctx.files, ctx.state)));
  return result;
}

/** the plan works and destroys nothing: no `-` and no `-/+` (or `+/-`) */
export const planDestroysNothing: Test = (ctx) => {
  const { ok, plan } = planNow(ctx);
  return ok && plan !== undefined && plan.changes.every((c) => c.action !== 'delete' && c.action !== 'replace');
};

/** something was applied, and the plan has nothing left to do: the code and the state agree */
export const inSync: Test = (ctx) => {
  const { ok, plan } = planNow(ctx);
  return ctx.state !== null && ok && plan !== undefined && plan.changes.length === 0;
};
