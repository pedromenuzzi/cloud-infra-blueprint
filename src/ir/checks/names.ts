/**
 * Cloud-side names the provider will refuse. The length limits come from the
 * catalog's naming rules (src/resources/naming.ts); the allowed characters
 * are listed here per type, and only where the cloud's rule is certain — the
 * generator's "lowercase and hyphens" style is stricter than many clouds, so
 * it can't be used to judge names people write themselves.
 */
import type { ResourceDef } from '@/resources/types';
import type { ResourceNode } from '../types';
import type { CheckContext } from './types';

interface NameRule {
  /** the argument holding the name (default: the def's `nameArg`) */
  arg?: string;
  pattern?: RegExp;
  /** how to write a valid name, for the message: "use lowercase letters, digits and hyphens" */
  allowed?: string;
  /** length limits other than the catalog's (e.g. GCS names with dots) are checked by `extra` */
  skipLength?: boolean;
  /** further rules: the problem, phrased to follow the quoted name */
  extra?: (name: string) => string | undefined;
}

const IP_LIKE = /^\d{1,3}(\.\d{1,3}){3}$/;

const RFC1035: NameRule = {
  pattern: /^[a-z]([-a-z0-9]*[a-z0-9])?$/,
  allowed: 'use lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen',
};
const AZURE_NETWORK: NameRule = {
  pattern: /^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9_])?$/,
  allowed: 'use letters, digits, underscores, dots and hyphens, starting with a letter or digit and ending with a letter, digit or underscore',
};
const ALNUM_HYPHEN: NameRule = {
  pattern: /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/,
  allowed: 'use letters, digits and hyphens, starting and ending with a letter or digit',
};
const LOWER_HYPHEN: NameRule = {
  pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  allowed: 'use lowercase letters, digits and hyphens, not starting or ending with a hyphen',
};
const WORD_HYPHEN: NameRule = { pattern: /^[A-Za-z0-9_-]+$/, allowed: 'use letters, digits, hyphens and underscores' };
const IAM: NameRule = { pattern: /^[\w+=,.@-]+$/, allowed: 'use letters, digits and + = , . @ _ -' };
const LOWER_IDENTIFIER: NameRule = {
  pattern: /^[a-z][a-z0-9-]*$/,
  allowed: 'use lowercase letters, digits and hyphens, starting with a letter',
  extra: (name) =>
    name.includes('--') ? "can't contain two hyphens in a row" : name.endsWith('-') ? "can't end with a hyphen" : undefined,
};
const FIFO: NameRule = {
  pattern: /^[A-Za-z0-9_-]+(\.fifo)?$/,
  allowed: 'use letters, digits, hyphens and underscores (FIFO names end in .fifo)',
};

function s3Problem(name: string): string | undefined {
  if (name.length < 3 || name.length > 63) return `is ${name.length} characters — S3 bucket names must be 3 to 63`;
  if (/[A-Z]/.test(name)) return 'has uppercase letters — S3 bucket names must be lowercase';
  if (name.includes('_')) return "has an underscore — S3 bucket names can't contain underscores (use hyphens)";
  if (/[^a-z0-9.-]/.test(name)) return 'has characters S3 refuses — use lowercase letters, digits, dots and hyphens';
  if (/^[.-]|[.-]$/.test(name)) return 'must start and end with a letter or digit';
  if (name.includes('..')) return "can't contain two dots in a row";
  if (IP_LIKE.test(name)) return "looks like an IP address, which S3 doesn't allow";
  if (/^(xn--|sthree-)/.test(name)) return 'starts with a prefix S3 reserves (xn--, sthree-)';
  if (/(-s3alias|--ol-s3)$/.test(name)) return 'ends with a suffix S3 reserves (-s3alias, --ol-s3)';
  return undefined;
}

function gcsProblem(name: string): string | undefined {
  const parts = name.split('.');
  if (name.length < 3) return `is ${name.length} characters — Cloud Storage bucket names need at least 3`;
  if (parts.length === 1 && name.length > 63) return `is ${name.length} characters — Cloud Storage bucket names can be at most 63 (222 with dots)`;
  if (name.length > 222 || parts.some((p) => p.length > 63)) return 'is too long — at most 222 characters, and 63 between dots';
  if (IP_LIKE.test(name)) return "looks like an IP address, which Cloud Storage doesn't allow";
  if (name.startsWith('goog') || name.includes('google')) return 'can\'t start with "goog" or contain "google"';
  return undefined;
}

const RULES: Record<string, NameRule> = {
  aws_s3_bucket: { arg: 'bucket', skipLength: true, extra: s3Problem },
  aws_lb: {
    ...ALNUM_HYPHEN,
    extra: (name) => (name.startsWith('internal-') ? 'can\'t start with "internal-" — AWS reserves it' : undefined),
  },
  aws_lb_target_group: ALNUM_HYPHEN,
  aws_security_group: {
    extra: (name) => (name.startsWith('sg-') ? 'can\'t start with "sg-" — AWS reserves it for group IDs' : undefined),
  },
  aws_iam_role: IAM,
  aws_iam_role_policy: IAM,
  aws_lambda_function: WORD_HYPHEN,
  aws_sqs_queue: FIFO,
  aws_sns_topic: FIFO,
  aws_dynamodb_table: { pattern: /^[A-Za-z0-9_.-]+$/, allowed: 'use letters, digits, underscores, hyphens and dots' },
  aws_elasticache_cluster: { arg: 'cluster_id', ...LOWER_IDENTIFIER },
  aws_db_instance: { arg: 'identifier', ...LOWER_IDENTIFIER },
  aws_db_subnet_group: {
    pattern: /^[a-z0-9 ._-]+$/,
    allowed: 'use lowercase letters, digits, spaces, dots, underscores and hyphens',
    extra: (name) => (name === 'default' ? 'is reserved — AWS already has a "default" DB subnet group' : undefined),
  },
  aws_ecr_repository: {
    pattern: /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    allowed: 'use lowercase letters and digits, separated by single dots, hyphens, underscores or slashes',
  },
  aws_ecs_cluster: WORD_HYPHEN,
  aws_ecs_service: WORD_HYPHEN,
  aws_ecs_task_definition: WORD_HYPHEN,
  aws_eks_cluster: {
    pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    allowed: 'use letters, digits, hyphens and underscores, starting with a letter or digit',
  },
  aws_secretsmanager_secret: { pattern: /^[A-Za-z0-9/_+=.@-]+$/, allowed: 'use letters, digits and / _ + = . @ -' },

  azurerm_resource_group: {
    pattern: /^[-\p{L}\p{N}_.()]*[-\p{L}\p{N}_()]$/u,
    allowed: 'use letters, digits, underscores, hyphens, dots and parentheses, not ending with a dot',
  },
  azurerm_virtual_network: AZURE_NETWORK,
  azurerm_subnet: AZURE_NETWORK,
  azurerm_network_security_group: AZURE_NETWORK,
  azurerm_network_interface: AZURE_NETWORK,
  azurerm_public_ip: AZURE_NETWORK,
  azurerm_storage_account: { pattern: /^[a-z0-9]+$/, allowed: 'use lowercase letters and digits only' },
  azurerm_container_registry: { pattern: /^[A-Za-z0-9]+$/, allowed: 'use letters and digits only' },
  azurerm_mssql_server: LOWER_HYPHEN,
  azurerm_postgresql_flexible_server: LOWER_HYPHEN,
  azurerm_cdn_profile: ALNUM_HYPHEN,
  azurerm_cdn_endpoint: ALNUM_HYPHEN,
  azurerm_linux_web_app: ALNUM_HYPHEN,
  azurerm_linux_function_app: ALNUM_HYPHEN,
  azurerm_redis_cache: {
    ...ALNUM_HYPHEN,
    extra: (name) => (name.includes('--') ? "can't contain two hyphens in a row" : undefined),
  },
  azurerm_kubernetes_cluster: {
    pattern: /^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/,
    allowed: 'use letters, digits, underscores and hyphens, starting and ending with a letter or digit',
  },
  azurerm_key_vault: {
    pattern: /^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/,
    allowed: 'use letters, digits and hyphens, starting with a letter and ending with a letter or digit',
    extra: (name) => (name.includes('--') ? "can't contain two hyphens in a row" : undefined),
  },
  azurerm_servicebus_namespace: {
    pattern: /^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/,
    allowed: 'use letters, digits and hyphens, starting with a letter and ending with a letter or digit',
  },
  azurerm_service_plan: { pattern: /^[\p{L}\p{N}-]+$/u, allowed: 'use letters, digits and hyphens' },

  google_compute_network: RFC1035,
  google_compute_subnetwork: RFC1035,
  google_compute_firewall: RFC1035,
  google_compute_instance: RFC1035,
  google_compute_backend_bucket: RFC1035,
  google_compute_url_map: RFC1035,
  google_compute_target_http_proxy: RFC1035,
  google_compute_global_forwarding_rule: RFC1035,
  google_compute_router: RFC1035,
  google_compute_router_nat: RFC1035,
  google_artifact_registry_repository: RFC1035,
  google_dns_managed_zone: RFC1035,
  google_cloudfunctions2_function: RFC1035,
  google_cloud_run_v2_service: RFC1035,
  google_container_cluster: RFC1035,
  google_container_node_pool: RFC1035,
  google_redis_instance: RFC1035,
  google_sql_database_instance: RFC1035,
  google_storage_bucket: {
    pattern: /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/,
    allowed: 'use lowercase letters, digits, hyphens, underscores and dots, starting and ending with a letter or digit',
    skipLength: true,
    extra: gcsProblem,
  },
  google_pubsub_topic: {
    pattern: /^[A-Za-z][A-Za-z0-9._~+%-]*$/,
    allowed: 'start with a letter, then use letters, digits and - _ . ~ + %',
    extra: (name) => (name.startsWith('goog') ? 'can\'t start with "goog"' : undefined),
  },
  google_pubsub_subscription: {
    pattern: /^[A-Za-z][A-Za-z0-9._~+%-]*$/,
    allowed: 'start with a letter, then use letters, digits and - _ . ~ + %',
    extra: (name) => (name.startsWith('goog') ? 'can\'t start with "goog"' : undefined),
  },
  google_bigquery_dataset: { pattern: /^[A-Za-z0-9_]+$/, allowed: 'use letters, digits and underscores' },
  google_service_account: {
    pattern: /^[a-z]([-a-z0-9]*[a-z0-9])?$/,
    allowed: 'use lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen',
  },
  google_secret_manager_secret: WORD_HYPHEN,
};

/** The problem with `name` for `def`, phrased to follow `name "…"`, or undefined when it is valid. */
export function nameProblem(def: ResourceDef, name: string): string | undefined {
  const rule = RULES[def.type] ?? {};
  const naming = def.naming;
  if (naming?.style === 'dns') return undefined;
  const label = `${def.displayName} names`;
  if (!rule.skipLength && naming?.maxLength !== undefined && name.length > naming.maxLength) {
    return `is ${name.length} characters — ${label} can be at most ${naming.maxLength}`;
  }
  if (!rule.skipLength && naming?.minLength !== undefined && name.length < naming.minLength) {
    return `is ${name.length} character${name.length === 1 ? '' : 's'} — ${label} need at least ${naming.minLength}`;
  }
  if (rule.pattern && !rule.pattern.test(name)) return `isn't a valid ${def.displayName} name — ${rule.allowed}`;
  return rule.extra?.(name);
}

function nameArg(def: ResourceDef): string | undefined {
  const rule = RULES[def.type];
  if (rule?.arg) return rule.arg;
  const arg = def.nameArg ?? 'name';
  return def.fields.some((f) => f.name === arg) ? arg : undefined;
}

export function nameChecks(ctx: CheckContext) {
  for (const node of ctx.ir.resources) {
    const def = ctx.getDef(node.type);
    const arg = def && nameArg(def);
    if (!def || !arg) continue;
    const value = literalName(node, arg);
    if (value === undefined) continue;
    const problem = nameProblem(def, value);
    if (problem) ctx.warn(node, arg, `${arg} "${value}" ${problem}`);
  }
}

/** Only names written out in full: templates and variables may well be fine once rendered. */
function literalName(node: ResourceNode, arg: string): string | undefined {
  const e = node.args[arg];
  return e?.kind === 'literal' && typeof e.value === 'string' && e.value !== '' ? e.value : undefined;
}
