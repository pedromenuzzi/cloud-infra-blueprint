/**
 * Predicates the guided projects (level 7) need on top of ../goals.ts and
 * the earlier levels' predicates. They follow references (through locals
 * too) rather than names, read the security lens for who may reach what,
 * and the app's real cost estimate for the budget: the learner's own names
 * and style pass as long as the architecture is the same.
 */
import { estimateWithModules } from '@/cost/modules';
// ponytail: the price tables join the bundle that holds the lessons (the editor's
// "Learn about this" imports them); a lazy import would need async goals
import { PRICE_BOOK } from '@/cost/prices/prices';
import { instancesOf as repeatInstances, stringFor } from '@/ir/checks/repeatValues';
import { exprText, instanceCount, localValue } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { argAt, referencedAddresses, resourcesOf, valueOf } from '../goals';
import type { LessonCtx } from '../types';
import { plannedOf } from './predicates-5';

type Test = (ctx: LessonCtx) => boolean;

/** what runs the app: plain instances, or an auto scaling group and its launch template */
export const APP_TYPES = ['aws_instance', 'aws_autoscaling_group', 'aws_launch_template'];

const asObject = (args: Record<string, Expression>): Expression => ({ kind: 'object', fields: args });

/** the addresses an expression reads, following `local.x` values (a local reading itself stops there) */
export function refsOf(ir: IR, e: Expression | undefined, seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const a of referencedAddresses(e)) {
    out.push(a);
    const name = /^local\.([A-Za-z_][\w-]*)/.exec(a)?.[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(...refsOf(ir, localValue(ir, name), seen));
    }
  }
  return out;
}

const reads = (ir: IR, e: Expression | undefined, type: string) => refsOf(ir, e).some((a) => a.startsWith(`${type}.`));

/** some resource of `type` reads a `targetType` resource (or data block, with `data.`) anywhere in its arguments */
const readsAnywhere = (ctx: LessonCtx, r: ResourceNode, targetType: string) => reads(ctx.ir, asObject(r.args), targetType);

/** the resources of `type` that `r` points at through `path` */
const targets = (ctx: LessonCtx, r: ResourceNode, path: string, type: string): ResourceNode[] => {
  const ids = new Set(refsOf(ctx.ir, argAt(r, path)).map((a) => a.replace(/\[.*$/, '')));
  return resourcesOf(ctx, type).filter((t) => ids.has(t.id));
};

/* ------------------------------------------------------------ project A: static site */

/** an object in a bucket of the code, stored under `key`, served with a `content_type` matching */
export const objectAt =
  (key: string, contentType: RegExp): Test =>
  (ctx) =>
    resourcesOf(ctx, 'aws_s3_object').some(
      (o) =>
        targets(ctx, o, 'bucket', 'aws_s3_bucket').length > 0 &&
        valueOf(ctx.ir, o.args.key) === key &&
        contentType.test(String(valueOf(ctx.ir, o.args.content_type) ?? '')) &&
        (o.args.content !== undefined || o.args.source !== undefined),
    );

/** the policy text of a bucket policy, with the policy documents it reads */
function policyParts(ctx: LessonCtx, e: Expression | undefined): Expression[] {
  const docs = ctx.ir.data.filter((d) => d.type === 'aws_iam_policy_document' && refsOf(ctx.ir, e).some((a) => a.startsWith(`${d.id}.`)));
  return [...(e ? [e] : []), ...docs.map((d) => asObject(d.args))];
}

/** a literal `"*"` principal: `identifiers = ["*"]`, `Principal = "*"`, `AWS = "*"` */
const ANYONE = /"identifiers":\{"kind":"list","items":\[[^\]]*"value":"\*"|Principal\\?"?\s*[=:]\s*\\?"\*|AWS\\?"?\s*[=:]\s*\\?"\*/;

/**
 * A policy on a bucket of the code lets in `service` (`cloudfront.amazonaws.com`)
 * only on behalf of a `sourceType` resource (its ARN in a condition), and nobody else.
 */
export const bucketPolicyFor =
  (service: string, sourceType: string): Test =>
  (ctx) =>
    resourcesOf(ctx, 'aws_s3_bucket_policy').some((p) => {
      if (targets(ctx, p, 'bucket', 'aws_s3_bucket').length === 0) return false;
      const parts = policyParts(ctx, p.args.policy);
      const text = JSON.stringify(parts);
      return text.includes(service) && !ANYONE.test(text) && parts.some((e) => reads(ctx.ir, e, sourceType));
    });

/** the region the provider of a resource runs in: its `provider = aws.<alias>`, or the default `aws` block */
function regionOf(ctx: LessonCtx, r: ResourceNode): string | undefined {
  const p = r.args.provider;
  const alias = p?.kind === 'ref' ? p.path.split('.')[1] : p?.kind === 'raw' ? p.hcl.trim().split('.')[1] : undefined;
  const block = ctx.ir.providers.find((b) => b.name === 'aws' && (alias === undefined ? b.args.alias === undefined : valueOf(ctx.ir, b.args.alias) === alias));
  const region = block ? valueOf(ctx.ir, block.args.region) : undefined;
  return typeof region === 'string' ? region : undefined;
}

/** an ACM certificate validated through DNS, issued in `region` (CloudFront reads them from us-east-1 only) */
export const certificateIn =
  (region: string): Test =>
  (ctx) =>
    resourcesOf(ctx, 'aws_acm_certificate').some(
      (c) => valueOf(ctx.ir, c.args.validation_method) === 'DNS' && regionOf(ctx, c) === region,
    );

/** a Route 53 record built from the certificate's validation options (through locals or `for_each`), and a validation that waits on it */
export const certificateValidated: Test = (ctx) =>
  resourcesOf(ctx, 'aws_route53_record').some((r) => readsAnywhere(ctx, r, 'aws_acm_certificate') && readsAnywhere(ctx, r, 'aws_route53_zone')) &&
  resourcesOf(ctx, 'aws_acm_certificate_validation').some(
    (v) => reads(ctx.ir, v.args.certificate_arn, 'aws_acm_certificate') && reads(ctx.ir, v.args.validation_record_fqdns, 'aws_route53_record'),
  );

/** the distribution answers to a name of its own, with that certificate and TLS 1.2 or newer */
export const distributionUsesCertificate: Test = (ctx) =>
  resourcesOf(ctx, 'aws_cloudfront_distribution').some((d) => {
    const cert = argAt(d, 'viewer_certificate.acm_certificate_arn');
    return (
      d.args.aliases !== undefined &&
      (reads(ctx.ir, cert, 'aws_acm_certificate_validation') || reads(ctx.ir, cert, 'aws_acm_certificate')) &&
      valueOf(ctx.ir, argAt(d, 'viewer_certificate.ssl_support_method')) === 'sni-only' &&
      /^TLSv1\.2/.test(String(valueOf(ctx.ir, argAt(d, 'viewer_certificate.minimum_protocol_version')) ?? ''))
    );
  });

/** an alias record in a zone of the code that points the name at the distribution */
export const aliasToDistribution: Test = (ctx) =>
  resourcesOf(ctx, 'aws_route53_record').some(
    (r) => reads(ctx.ir, r.args.zone_id, 'aws_route53_zone') && reads(ctx.ir, argAt(r, 'alias.name'), 'aws_cloudfront_distribution'),
  );

/* ------------------------------------------------------------ project B: serverless API */

/** a table whose partition key (`hash_key`) is declared as an attribute */
export const keyDeclared: Test = (ctx) =>
  resourcesOf(ctx, 'aws_dynamodb_table').some((t) => {
    const key = valueOf(ctx.ir, t.args.hash_key);
    const attrs = t.args.attribute;
    const bodies = attrs?.kind === 'block' ? [attrs.body] : attrs?.kind === 'blocks' ? attrs.items : [];
    return key !== undefined && bodies.some((b) => valueOf(ctx.ir, b.name) === key && /^[SNB]$/.test(String(valueOf(ctx.ir, b.type))));
  });

/** the function runs as a role the Lambda service may assume, and ships code (a zip, an S3 object or an image) */
export const functionWithRole: Test = (ctx) =>
  resourcesOf(ctx, 'aws_lambda_function').some(
    (f) =>
      (f.args.filename ?? f.args.s3_key ?? f.args.image_uri) !== undefined &&
      targets(ctx, f, 'role', 'aws_iam_role').some((role) => {
        const policy = role.args.assume_role_policy;
        return JSON.stringify(policyParts(ctx, policy)).includes('lambda.amazonaws.com');
      }),
  );

/** the policies a role holds: inline ones, and attached ones (managed ARNs as their text) */
function rolePolicies(ctx: LessonCtx, role: ResourceNode): Expression[] {
  const ofRole = (r: ResourceNode) => targets(ctx, r, 'role', 'aws_iam_role').includes(role);
  const inline = resourcesOf(ctx, 'aws_iam_role_policy').filter(ofRole).flatMap((p) => policyParts(ctx, p.args.policy));
  const attached = resourcesOf(ctx, 'aws_iam_role_policy_attachment')
    .filter(ofRole)
    .flatMap((a) => {
      const own = targets(ctx, a, 'policy_arn', 'aws_iam_policy');
      return own.length ? own.flatMap((p) => policyParts(ctx, p.args.policy)) : a.args.policy_arn ? [a.args.policy_arn] : [];
    });
  return [...inline, ...attached];
}

/** a `"*"` resource: `resources = ["*"]`, `Resource = "*"` */
const EVERY_RESOURCE = /"resources":\{"kind":"list","items":\[[^\]]*"value":"\*"|Resource\\?"?\s*[=:]\s*\[?\s*\\?"\*\\?"/;

/**
 * The function's role may use a DynamoDB table of the code, named by its ARN:
 * no `dynamodb:*`, no `"*"` resource, no full-access managed policy.
 */
export const scopedToTable: Test = (ctx) =>
  resourcesOf(ctx, 'aws_lambda_function').some((f) =>
    targets(ctx, f, 'role', 'aws_iam_role').some((role) => {
      const policies = rolePolicies(ctx, role);
      const text = JSON.stringify(policies);
      return (
        /dynamodb:[A-Z]/.test(text) &&
        policies.some((p) => reads(ctx.ir, p, 'aws_dynamodb_table')) &&
        !/dynamodb:\*|"\*:\*"|FullAccess|AdministratorAccess/.test(text) &&
        !EVERY_RESOURCE.test(text)
      );
    }),
  );

/** the function learns the table's name from an environment variable */
export const tableInEnvironment: Test = (ctx) =>
  resourcesOf(ctx, 'aws_lambda_function').some((f) => reads(ctx.ir, argAt(f, 'environment.variables'), 'aws_dynamodb_table'));

/** a log group with a retention, that the function writes to (named after it, or set in its `logging_config`) */
export const functionLogs: Test = (ctx) =>
  resourcesOf(ctx, 'aws_cloudwatch_log_group').some((g) => {
    const days = valueOf(ctx.ir, g.args.retention_in_days);
    if (typeof days !== 'number' || days <= 0) return false;
    const name = String(valueOf(ctx.ir, g.args.name) ?? (g.args.name ? exprText(g.args.name) : ''));
    return resourcesOf(ctx, 'aws_lambda_function').some((f) => {
      const fn = valueOf(ctx.ir, f.args.function_name);
      return (
        targets(ctx, f, 'logging_config.log_group', 'aws_cloudwatch_log_group').includes(g) ||
        (typeof fn === 'string' && name === `/aws/lambda/${fn}`) ||
        refsOf(ctx.ir, g.args.name).includes(`${f.id}.function_name`)
      );
    });
  });

/** an HTTP API with a stage that deploys every change by itself */
export const httpApiLive: Test = (ctx) =>
  resourcesOf(ctx, 'aws_apigatewayv2_api').some(
    (api) =>
      (valueOf(ctx.ir, api.args.protocol_type) ?? 'HTTP') === 'HTTP' &&
      resourcesOf(ctx, 'aws_apigatewayv2_stage').some((s) => targets(ctx, s, 'api_id', 'aws_apigatewayv2_api').includes(api) && valueOf(ctx.ir, s.args.auto_deploy) === true),
  );

/** a route whose target is an integration that proxies to a Lambda function */
export const routeToFunction: Test = (ctx) =>
  resourcesOf(ctx, 'aws_apigatewayv2_route').some(
    (route) =>
      valueOf(ctx.ir, route.args.route_key) !== undefined &&
      targets(ctx, route, 'target', 'aws_apigatewayv2_integration').some(
        (i) => valueOf(ctx.ir, i.args.integration_type) === 'AWS_PROXY' && reads(ctx.ir, i.args.integration_uri, 'aws_lambda_function'),
      ),
  );

/** the function lets API Gateway invoke it, from this API only (`source_arn`) */
export const apiMayInvoke: Test = (ctx) =>
  resourcesOf(ctx, 'aws_lambda_permission').some(
    (p) =>
      valueOf(ctx.ir, p.args.principal) === 'apigateway.amazonaws.com' &&
      /^lambda:InvokeFunction$/.test(String(valueOf(ctx.ir, p.args.action))) &&
      reads(ctx.ir, p.args.function_name, 'aws_lambda_function') &&
      reads(ctx.ir, p.args.source_arn, 'aws_apigatewayv2_api'),
  );

/* ------------------------------------------------------------ project C: three tiers */

const subnetKind = (ctx: LessonCtx, s: ResourceNode) => ctx.audit.topology.subnets.get(s.id);

/** one token per instance of a subnet for its zone: the value when certain, else the expression (unique per instance when it varies) */
function zoneTokens(ctx: LessonCtx, subnet: ResourceNode): string[] {
  const expr = subnet.args.availability_zone ?? subnet.args.availability_zone_id;
  if (!expr) return [];
  const perInstance = /\b(count\.index|each\.(key|value))\b/.test(exprText(expr));
  return (repeatInstances(subnet, ctx.ir) ?? [undefined]).map(
    (instance, i) => stringFor(expr, ctx.ir, instance) ?? `?${exprText(expr)}${perInstance ? `#${i}` : ''}`,
  );
}

/**
 * The zones `path` of `r` can land in: every zone of the subnets it reads,
 * or one zone when it names an instance (`aws_subnet.private[0].id`).
 */
function zonesAt(ctx: LessonCtx, r: ResourceNode, path: string): string[] {
  const e = argAt(r, path);
  return targets(ctx, r, path, 'aws_subnet').flatMap((s) => {
    const tokens = zoneTokens(ctx, s);
    const index = new RegExp(`${s.id.replace('.', '\\.')}\\[(\\d+)\\]`).exec(e ? exprText(e) : '')?.[1];
    return index !== undefined && !/\b(count\.index|each\.)/.test(e ? exprText(e) : '') ? (tokens[Number(index)] ?? []) : tokens;
  });
}

/** every subnet `path` of `r` reads is of this kind, in at least two zones */
const placedIn = (ctx: LessonCtx, r: ResourceNode, path: string, kind: 'public' | 'private') => {
  const subnets = targets(ctx, r, path, 'aws_subnet');
  return subnets.length > 0 && subnets.every((s) => subnetKind(ctx, s) === kind) && new Set(zonesAt(ctx, r, path)).size >= 2;
};

/** a plan from nothing, with every variable at its default, creates no resource of `type` */
export const offByDefault =
  (type: string): Test =>
  (ctx) => {
    const planned = plannedOf(ctx.files);
    return planned !== null && ![...planned.keys()].some((a) => a.startsWith(`${type}.`) || a.startsWith(`${type}[`));
  };

/** a route to a NAT gateway (inline, or an `aws_route`) in a route table that private subnets use */
export const natRouteForPrivate: Test = (ctx) => {
  const tables = new Set(
    resourcesOf(ctx, 'aws_route_table_association')
      .filter((a) => targets(ctx, a, 'subnet_id', 'aws_subnet').some((s) => subnetKind(ctx, s) === 'private'))
      .flatMap((a) => targets(ctx, a, 'route_table_id', 'aws_route_table')),
  );
  const toNat = (e: Expression | undefined) => reads(ctx.ir, e, 'aws_nat_gateway');
  return (
    [...tables].some((t) => {
      const routes = t.args.route;
      const bodies = routes?.kind === 'block' ? [routes.body] : routes?.kind === 'blocks' ? routes.items : [];
      return bodies.some((b) => toNat(b.nat_gateway_id));
    }) ||
    resourcesOf(ctx, 'aws_route').some(
      (r) => toNat(r.args.nat_gateway_id) && targets(ctx, r, 'route_table_id', 'aws_route_table').some((t) => tables.has(t)),
    )
  );
};

/** an internet facing application load balancer in public subnets of two zones */
export const loadBalancerPublic: Test = (ctx) =>
  resourcesOf(ctx, 'aws_lb').some(
    (lb) => (valueOf(ctx.ir, lb.args.load_balancer_type) ?? 'application') === 'application' && valueOf(ctx.ir, lb.args.internal) !== true && placedIn(ctx, lb, 'subnets', 'public'),
  );

/** at least `min` app servers in `kind` subnets of two zones: instances (count or separate blocks) or an auto scaling group */
export const appServersIn =
  (kind: 'public' | 'private', min = 2): Test =>
  (ctx) => {
    const instances = resourcesOf(ctx, 'aws_instance').filter((i) => targets(ctx, i, 'subnet_id', 'aws_subnet').every((s) => subnetKind(ctx, s) === kind) && i.args.subnet_id);
    const count = instances.reduce((n, i) => n + (instanceCount(i, ctx.ir) ?? 1), 0);
    const zones = new Set(instances.flatMap((i) => zonesAt(ctx, i, 'subnet_id')));
    const groups = resourcesOf(ctx, 'aws_autoscaling_group').filter((g) => {
      const size = valueOf(ctx.ir, g.args.min_size);
      return typeof size === 'number' && size >= min && placedIn(ctx, g, 'vpc_zone_identifier', kind);
    });
    return groups.length > 0 || (count >= min && zones.size >= 2);
  };

/** a target group that checks a path, with the app servers registered in it */
export const healthChecked: Test = (ctx) =>
  resourcesOf(ctx, 'aws_lb_target_group').some((tg) => {
    const registers = (r: ResourceNode, path: string) => targets(ctx, r, path, 'aws_lb_target_group').includes(tg);
    return (
      argAt(tg, 'health_check.path') !== undefined &&
      (resourcesOf(ctx, 'aws_lb_target_group_attachment').some((a) => registers(a, 'target_group_arn') && reads(ctx.ir, a.args.target_id, 'aws_instance')) ||
        resourcesOf(ctx, 'aws_autoscaling_group').some((g) => registers(g, 'target_group_arns')) ||
        resourcesOf(ctx, 'aws_autoscaling_attachment').some((a) => registers(a, 'lb_target_group_arn')))
    );
  });

const listenersOf = (ctx: LessonCtx) => resourcesOf(ctx, 'aws_lb_listener').filter((l) => reads(ctx.ir, l.args.load_balancer_arn, 'aws_lb'));
const protocolOf = (ctx: LessonCtx, l: ResourceNode) => String(valueOf(ctx.ir, l.args.protocol) ?? 'HTTP');

/** a listener of `protocol` on the load balancer that forwards to a target group */
export const forwards =
  (protocol: 'HTTP' | 'HTTPS'): Test =>
  (ctx) =>
    listenersOf(ctx).some(
      (l) =>
        protocolOf(ctx, l) === protocol &&
        (reads(ctx.ir, argAt(l, 'default_action.target_group_arn'), 'aws_lb_target_group') ||
          reads(ctx.ir, argAt(l, 'default_action.forward'), 'aws_lb_target_group')),
    );

/** an HTTPS listener whose certificate comes from a variable, a certificate of the code or a lookup, never a pasted ARN */
export const httpsListener: Test = (ctx) =>
  forwards('HTTPS')(ctx) &&
  listenersOf(ctx).some((l) => protocolOf(ctx, l) === 'HTTPS' && refsOf(ctx.ir, l.args.certificate_arn).some((a) => /^(var\.|aws_acm_certificate|data\.aws_acm_certificate\.)/.test(a)));

/** an HTTP listener that answers with a redirect to HTTPS */
export const redirectsToHttps: Test = (ctx) =>
  listenersOf(ctx).some(
    (l) =>
      protocolOf(ctx, l) === 'HTTP' &&
      valueOf(ctx.ir, argAt(l, 'default_action.type')) === 'redirect' &&
      valueOf(ctx.ir, argAt(l, 'default_action.redirect.protocol')) === 'HTTPS',
  );

/**
 * Every resource of `targetTypes` is protected by security groups whose
 * inbound rules all name a group of a `sourceTypes` resource: no address
 * range, no rule the lens can't read.
 */
export const onlyFrom =
  (targetTypes: string[], sourceTypes: string[]): Test =>
  (ctx) => {
    const { attachments, rules, hidden } = ctx.audit.topology;
    const sourceGroups = new Set(ctx.ir.resources.filter((r) => sourceTypes.includes(r.type)).flatMap((r) => attachments.get(r.id) ?? []));
    const guarded = ctx.ir.resources.filter((r) => targetTypes.includes(r.type));
    return (
      guarded.length > 0 &&
      guarded.every((r) => {
        const groups = attachments.get(r.id) ?? [];
        const inbound = groups.flatMap((g) => (rules.get(g) ?? []).filter((x) => x.direction === 'inbound' && x.action === 'allow'));
        const unreadable = groups.some((g) => hidden.get(g)?.some((h) => h.directions.includes('inbound')));
        return (
          groups.length > 0 &&
          !unreadable &&
          inbound.length > 0 &&
          inbound.every((x) => x.peers.length > 0 && x.peers.every((p) => p.kind === 'group' && sourceGroups.has(p.ref) && !groups.includes(p.ref)))
        );
      })
    );
  };

/** the database sits in a subnet group of private subnets in two zones */
export const databaseInPrivateSubnets: Test = (ctx) =>
  resourcesOf(ctx, 'aws_db_instance').some((db) =>
    targets(ctx, db, 'db_subnet_group_name', 'aws_db_subnet_group').some((g) => placedIn(ctx, g, 'subnet_ids', 'private')),
  );

/** the database's password never sits in the code: RDS manages it, or it comes from a variable marked `sensitive` */
export const passwordKeptSecret: Test = (ctx) =>
  resourcesOf(ctx, 'aws_db_instance').some((db) => {
    if (valueOf(ctx.ir, db.args.manage_master_user_password) === true) return db.args.password === undefined;
    const vars = refsOf(ctx.ir, db.args.password).flatMap((a) => /^var\.(\w+)/.exec(a)?.[1] ?? []);
    return vars.length > 0 && vars.every((name) => ctx.ir.variables.some((v) => v.name === name && valueOf(ctx.ir, v.args.sensitive) === true));
  });

/* ------------------------------------------------------------ the bill */

/**
 * The app's cost estimate (the same numbers its cost panel shows, local
 * modules included) stays within `budget` dollars a month, with the
 * architecture priced: a load balancer, a database and at least two app
 * servers (instances, or an auto scaling group's fleet), so leaving pieces
 * out or hiding them where the estimate can't see doesn't pass.
 */
export const withinBudget =
  (budget: number): Test =>
  (ctx) => {
    const cost = estimateWithModules(ctx.ir, ctx.files, PRICE_BOOK, 'en');
    const priced = (type: string) => cost.items.filter((i) => i.type === type && i.kind === 'fixed');
    // an auto scaling group is priced for its desired (else minimum) size, one item for the whole fleet
    const fleet = priced('aws_autoscaling_group').reduce((n, i) => {
      const group = ctx.ir.resources.find((r) => r.id === i.id);
      const size = group && (valueOf(ctx.ir, group.args.desired_capacity) ?? valueOf(ctx.ir, group.args.min_size));
      return n + (typeof size === 'number' ? size : 0);
    }, 0);
    return (
      cost.total <= budget &&
      priced('aws_lb').length > 0 &&
      priced('aws_db_instance').length > 0 &&
      priced('aws_instance').reduce((n, i) => n + i.count, 0) + fleet >= 2
    );
  };

/** the last apply left a resource of `type` whose `attr` is `value` */
export const appliedWith =
  (type: string, attr: string, value: string): Test =>
  (ctx) =>
    ctx.state !== null &&
    Object.entries(ctx.state.resources).some(([address, attrs]) => address.split('.').at(-2) === type && attrs[attr] === value);
