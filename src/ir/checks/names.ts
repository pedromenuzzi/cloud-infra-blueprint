/**
 * Cloud-side names the provider will refuse. The length limits come from the
 * catalog's naming rules (src/resources/naming.ts); the allowed characters
 * are listed here per type, and only where the cloud's rule is certain — the
 * generator's "lowercase and hyphens" style is stricter than many clouds, so
 * it can't be used to judge names people write themselves.
 */
import { messagesFor } from '@/i18n/messages';
import { resourceName } from '@/resources/i18n';
import type { ResourceDef } from '@/resources/types';
import type { ResourceNode } from '../types';
import { checkMessages, type CheckText } from './messages';
import type { CheckContext } from './types';

interface NameRule {
  /** the argument holding the name (default: the def's `nameArg`) */
  arg?: string;
  pattern?: RegExp;
  /** how to write a valid name, for the message: "use lowercase letters, digits and hyphens" */
  allowed?: (m: CheckText) => string;
  /** length limits other than the catalog's (e.g. GCS names with dots) are checked by `extra` */
  skipLength?: boolean;
  /** further rules: the problem, phrased to follow the quoted name */
  extra?: (name: string, m: CheckText) => string | undefined;
}

const IP_LIKE = /^\d{1,3}(\.\d{1,3}){3}$/;

const RFC1035: NameRule = {
  pattern: /^[a-z]([-a-z0-9]*[a-z0-9])?$/,
  allowed: (m) => m.allowed.rfc1035,
};
const AZURE_NETWORK: NameRule = {
  pattern: /^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9_])?$/,
  allowed: (m) => m.allowed.azureNetwork,
};
const ALNUM_HYPHEN: NameRule = {
  pattern: /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/,
  allowed: (m) => m.allowed.alnumHyphen,
};
const LOWER_HYPHEN: NameRule = {
  pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  allowed: (m) => m.allowed.lowerHyphen,
};
const WORD_HYPHEN: NameRule = { pattern: /^[A-Za-z0-9_-]+$/, allowed: (m) => m.allowed.wordHyphen };
const IAM: NameRule = { pattern: /^[\w+=,.@-]+$/, allowed: (m) => m.allowed.iam };
const LOWER_IDENTIFIER: NameRule = {
  pattern: /^[a-z][a-z0-9-]*$/,
  allowed: (m) => m.allowed.lowerIdentifier,
  extra: (name, m) => (name.includes('--') ? m.doubleHyphen : name.endsWith('-') ? m.endsWithHyphen : undefined),
};
const FIFO: NameRule = {
  pattern: /^[A-Za-z0-9_-]+(\.fifo)?$/,
  allowed: (m) => m.allowed.fifo,
};

function s3Problem(name: string, { s3 }: CheckText): string | undefined {
  if (name.length < 3 || name.length > 63) return s3.length(name.length);
  if (/[A-Z]/.test(name)) return s3.uppercase;
  if (name.includes('_')) return s3.underscore;
  if (/[^a-z0-9.-]/.test(name)) return s3.characters;
  if (/^[.-]|[.-]$/.test(name)) return s3.edges;
  if (name.includes('..')) return s3.doubleDot;
  if (IP_LIKE.test(name)) return s3.ipLike;
  if (/^(xn--|sthree-)/.test(name)) return s3.prefix;
  if (/(-s3alias|--ol-s3)$/.test(name)) return s3.suffix;
  return undefined;
}

function gcsProblem(name: string, { gcs }: CheckText): string | undefined {
  const parts = name.split('.');
  if (name.length < 3) return gcs.tooShort(name.length);
  if (parts.length === 1 && name.length > 63) return gcs.tooLongNoDots(name.length);
  if (name.length > 222 || parts.some((p) => p.length > 63)) return gcs.tooLong;
  if (IP_LIKE.test(name)) return gcs.ipLike;
  if (name.startsWith('goog') || name.includes('google')) return gcs.google;
  return undefined;
}

const RULES: Record<string, NameRule> = {
  aws_s3_bucket: { arg: 'bucket', skipLength: true, extra: s3Problem },
  aws_lb: {
    ...ALNUM_HYPHEN,
    extra: (name, m) => (name.startsWith('internal-') ? m.lbInternalPrefix : undefined),
  },
  aws_lb_target_group: ALNUM_HYPHEN,
  aws_security_group: {
    extra: (name, m) => (name.startsWith('sg-') ? m.sgPrefix : undefined),
  },
  aws_iam_role: IAM,
  aws_iam_role_policy: IAM,
  aws_lambda_function: WORD_HYPHEN,
  aws_sqs_queue: FIFO,
  aws_sns_topic: FIFO,
  aws_dynamodb_table: { pattern: /^[A-Za-z0-9_.-]+$/, allowed: (m) => m.allowed.dynamodb },
  aws_elasticache_cluster: { arg: 'cluster_id', ...LOWER_IDENTIFIER },
  aws_db_instance: { arg: 'identifier', ...LOWER_IDENTIFIER },
  aws_rds_cluster: { arg: 'cluster_identifier', ...LOWER_IDENTIFIER },
  aws_db_subnet_group: {
    pattern: /^[a-z0-9 ._-]+$/,
    allowed: (m) => m.allowed.dbSubnetGroup,
    extra: (name, m) => (name === 'default' ? m.defaultDbSubnetGroup : undefined),
  },
  aws_ecr_repository: {
    pattern: /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    allowed: (m) => m.allowed.ecr,
  },
  aws_ecs_cluster: WORD_HYPHEN,
  aws_ecs_service: WORD_HYPHEN,
  aws_ecs_task_definition: WORD_HYPHEN,
  aws_eks_cluster: {
    pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    allowed: (m) => m.allowed.eks,
  },
  aws_secretsmanager_secret: { pattern: /^[A-Za-z0-9/_+=.@-]+$/, allowed: (m) => m.allowed.secretsManager },

  azurerm_resource_group: {
    pattern: /^[-\p{L}\p{N}_.()]*[-\p{L}\p{N}_()]$/u,
    allowed: (m) => m.allowed.resourceGroup,
  },
  azurerm_virtual_network: AZURE_NETWORK,
  azurerm_subnet: AZURE_NETWORK,
  azurerm_network_security_group: AZURE_NETWORK,
  azurerm_network_interface: AZURE_NETWORK,
  azurerm_public_ip: AZURE_NETWORK,
  azurerm_storage_account: { pattern: /^[a-z0-9]+$/, allowed: (m) => m.allowed.storageAccount },
  azurerm_container_registry: { pattern: /^[A-Za-z0-9]+$/, allowed: (m) => m.allowed.lettersDigits },
  azurerm_mssql_server: LOWER_HYPHEN,
  azurerm_postgresql_flexible_server: LOWER_HYPHEN,
  azurerm_cdn_profile: ALNUM_HYPHEN,
  azurerm_cdn_endpoint: ALNUM_HYPHEN,
  azurerm_linux_web_app: ALNUM_HYPHEN,
  azurerm_linux_function_app: ALNUM_HYPHEN,
  azurerm_redis_cache: {
    ...ALNUM_HYPHEN,
    extra: (name, m) => (name.includes('--') ? m.doubleHyphen : undefined),
  },
  azurerm_kubernetes_cluster: {
    pattern: /^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/,
    allowed: (m) => m.allowed.aks,
  },
  azurerm_key_vault: {
    pattern: /^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/,
    allowed: (m) => m.allowed.keyVault,
    extra: (name, m) => (name.includes('--') ? m.doubleHyphen : undefined),
  },
  azurerm_servicebus_namespace: {
    pattern: /^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/,
    allowed: (m) => m.allowed.keyVault,
  },
  azurerm_service_plan: { pattern: /^[\p{L}\p{N}-]+$/u, allowed: (m) => m.allowed.servicePlan },

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
    allowed: (m) => m.allowed.gcs,
    skipLength: true,
    extra: gcsProblem,
  },
  google_pubsub_topic: {
    pattern: /^[A-Za-z][A-Za-z0-9._~+%-]*$/,
    allowed: (m) => m.allowed.pubsub,
    extra: (name, m) => (name.startsWith('goog') ? m.googPrefix : undefined),
  },
  google_pubsub_subscription: {
    pattern: /^[A-Za-z][A-Za-z0-9._~+%-]*$/,
    allowed: (m) => m.allowed.pubsub,
    extra: (name, m) => (name.startsWith('goog') ? m.googPrefix : undefined),
  },
  google_bigquery_dataset: { pattern: /^[A-Za-z0-9_]+$/, allowed: (m) => m.allowed.bigquery },
  google_service_account: {
    pattern: /^[a-z]([-a-z0-9]*[a-z0-9])?$/,
    allowed: (m) => m.allowed.rfc1035,
  },
  google_secret_manager_secret: WORD_HYPHEN,
};

/**
 * The problem with `name` for `def`, phrased to follow `name "…"`, or
 * undefined when it is valid — in the UI language in effect.
 */
export function nameProblem(def: ResourceDef, name: string): string | undefined {
  const rule = RULES[def.type] ?? {};
  const naming = def.naming;
  if (naming?.style === 'dns') return undefined;
  const m = messagesFor(checkMessages);
  const resource = resourceName(def.type);
  if (!rule.skipLength && naming?.maxLength !== undefined && name.length > naming.maxLength) {
    return m.tooLong(name.length, resource, naming.maxLength);
  }
  if (!rule.skipLength && naming?.minLength !== undefined && name.length < naming.minLength) {
    return m.tooShort(name.length, resource, naming.minLength);
  }
  if (rule.pattern && !rule.pattern.test(name)) return m.notValid(resource, rule.allowed?.(m) ?? '');
  return rule.extra?.(name, m);
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
    if (problem) ctx.warn(node, arg, messagesFor(checkMessages).nameProblem(arg, value, problem));
  }
}

/** Only names written out in full: templates and variables may well be fine once rendered. */
function literalName(node: ResourceNode, arg: string): string | undefined {
  const e = node.args[arg];
  return e?.kind === 'literal' && typeof e.value === 'string' && e.value !== '' ? e.value : undefined;
}
