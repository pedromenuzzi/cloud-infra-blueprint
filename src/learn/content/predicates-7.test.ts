/**
 * The level 7 goals against what learners really write: other names and
 * styles (inline policies, `for_each` validation records, separate server
 * blocks, a sensitive variable), and the slips they should catch (a public
 * principal, full access, a server in one zone, an address range where a
 * security group belongs, a pasted password, a bill over budget).
 */
import { describe, expect, it } from 'vitest';
import { checkGoals, lessonContext } from '../goals';
import { getLesson } from '../lessons';
import type { Files } from '../types';
import { plannedOf } from './predicates-5';

/** goal id → met, for a lesson's goals against these files */
function goals(slug: string, files: Files): Record<string, boolean> {
  const lesson = getLesson(slug)!;
  const met = checkGoals(lesson.goals, lessonContext(files));
  return Object.fromEntries(lesson.goals.map((g, i) => [g.id, met[i]]));
}

/** the lesson's solution with `from` replaced by `to` in `file` (the text must be there) */
function edit(slug: string, file: string, ...pairs: Array<[string | RegExp, string]>): Files {
  const solution = getLesson(slug)!.solution;
  let text = solution[file];
  for (const [from, to] of pairs) {
    const next = text.replace(from, to);
    expect(next, String(from)).not.toBe(text);
    text = next;
  }
  return { ...solution, [file]: text };
}

describe('7.1 and 7.2: the site bucket and its one reader', () => {
  it('takes a fixed bucket name and a charset, not a page without a type', () => {
    expect(goals('site-bucket', edit('site-bucket', 'main.tf', ['bucket_prefix = "learn-site-"', 'bucket = "acme-site-1234"'], ['"text/html"', '"text/html; charset=utf-8"']))).toMatchObject({
      bucket: true,
      private: true,
      page: true,
    });
    expect(goals('site-bucket', edit('site-bucket', 'main.tf', ['  content_type = "text/html"\n', '']))).toMatchObject({ page: false });
  });

  const INLINE_POLICY = `resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "s3:GetObject"
      Resource  = "\${aws_s3_bucket.site.arn}/*"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
    }]
  })
}`;
  const withPolicy = (policy: string) => {
    const files = getLesson('site-cdn')!.solution;
    const cdn = files['cdn.tf'].replace(/data "aws_iam_policy_document"[\s\S]*?\n}\n\nresource "aws_s3_bucket_policy"[\s\S]*?\n}/, policy);
    expect(cdn).not.toBe(files['cdn.tf']);
    return goals('site-cdn', { ...files, 'cdn.tf': cdn });
  };

  it('accepts a policy written inline with jsonencode', () => {
    expect(withPolicy(INLINE_POLICY)).toMatchObject({ origin: true, policy: true });
  });

  it('refuses a policy open to anyone, or to any distribution', () => {
    expect(withPolicy(INLINE_POLICY.replace('{ Service = "cloudfront.amazonaws.com" }', '"*"'))).toMatchObject({ policy: false });
    expect(withPolicy(INLINE_POLICY.replace(/\n {6}Condition.*\n/, '\n'))).toMatchObject({ policy: false });
  });
});

describe('7.3: the certificate, wherever it is written', () => {
  const FOR_EACH = `resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o
  }

  zone_id = aws_route53_zone.site.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "site" {
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}`;

  it('accepts the for_each validation records of the provider docs', () => {
    const files = edit('site-dns-https', 'dns.tf', [/locals \{[\s\S]*?\n}\n\nresource "aws_route53_record" "validation"[\s\S]*?\n}\n\nresource "aws_acm_certificate_validation"[\s\S]*?\n}/, FOR_EACH]);
    expect(goals('site-dns-https', files)).toMatchObject({ cert: true, validated: true, tls: true, alias: true });
  });

  it('follows a provider alias to its region', () => {
    const aliased = (region: string) =>
      goals(
        'site-dns-https',
        edit('site-dns-https', 'dns.tf', ['resource "aws_acm_certificate" "site" {\n', `provider "aws" {\n  alias  = "edge"\n  region = "${region}"\n}\n\nresource "aws_acm_certificate" "site" {\n  provider = aws.edge\n`]),
      );
    expect(aliased('us-east-1')).toMatchObject({ cert: true });
    expect(aliased('sa-east-1')).toMatchObject({ cert: false });
  });

  it('wants the certificate on the distribution, not the default one', () => {
    const files = getLesson('site-dns-https')!.solution;
    expect(goals('site-dns-https', { ...files, 'cdn.tf': getLesson('site-cdn')!.solution['cdn.tf'] })).toMatchObject({ tls: false, alias: true });
  });
});

describe('7.5: least privilege, read from any policy style', () => {
  const POLICY = /resource "aws_iam_role_policy" "api" \{[\s\S]*?\n}\n/;

  it('accepts a policy document scoped to the table', () => {
    const files = edit('api-function', 'function.tf', [
      POLICY,
      `data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["dynamodb:Scan", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.items.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.name
  policy = data.aws_iam_policy_document.api.json
}
`,
    ]);
    expect(goals('api-function', files)).toMatchObject({ role: true, scoped: true, env: true, logs: true });
  });

  it('refuses full access, a wildcard action or every resource', () => {
    const managed = edit('api-function', 'function.tf', [
      POLICY,
      'resource "aws_iam_role_policy_attachment" "api" {\n  role       = aws_iam_role.api.name\n  policy_arn = "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess"\n}\n',
    ]);
    expect(goals('api-function', managed)).toMatchObject({ scoped: false });
    expect(goals('api-function', edit('api-function', 'function.tf', ['"dynamodb:GetItem", ', '"dynamodb:*", ']))).toMatchObject({ scoped: false });
    expect(goals('api-function', edit('api-function', 'function.tf', ['Resource = aws_dynamodb_table.items.arn', 'Resource = "*"']))).toMatchObject({ scoped: false });
  });

  it('ties the log group by name too, but wants a retention', () => {
    const byName = edit('api-function', 'function.tf', [/\n {2}logging_config \{[\s\S]*?\n {2}}\n/, '\n']);
    expect(goals('api-function', byName)).toMatchObject({ logs: true });
    expect(goals('api-function', edit('api-function', 'function.tf', ['  retention_in_days = 14\n', '']))).toMatchObject({ logs: false });
  });
});

describe('7.7: the NAT switch', () => {
  it('plans the gateway only when the switch is on, and wants it off by default', () => {
    const on = edit('tier-network', 'network.tf', ['default     = false', 'default     = true']);
    expect([...plannedOf(on)!.keys()]).toContain('aws_nat_gateway.main[0]');
    expect(goals('tier-network', on)).toMatchObject({ switch: false, route: true });
  });

  it('accepts the NAT route written inline in the private route table', () => {
    const files = edit(
      'tier-network',
      'network.tf',
      ['resource "aws_route_table" "private" {\n  vpc_id = aws_vpc.main.id\n}', 'resource "aws_route_table" "private" {\n  vpc_id = aws_vpc.main.id\n\n  route {\n    cidr_block     = "0.0.0.0/0"\n    nat_gateway_id = aws_nat_gateway.main[0].id\n  }\n}'],
      [/\nresource "aws_route" "private_nat" \{[\s\S]*?\n}\n/, '\n'],
    );
    expect(goals('tier-network', files)).toMatchObject({ public: true, private: true, route: true });
  });
});

describe('7.8: the app tier, in any shape that keeps it private', () => {
  const SEPARATE = (subnetB: string) => `resource "aws_instance" "app_a" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.app.id]
}

resource "aws_instance" "app_b" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = ${subnetB}
  vpc_security_group_ids = [aws_security_group.app.id]
}

resource "aws_lb_target_group_attachment" "a" {
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app_a.id
}
`;
  /** the solution with its `count` servers (and their attachments) traded for two blocks */
  const withServers = (subnetB: string) =>
    goals(
      'tier-app',
      edit(
        'tier-app',
        'app.tf',
        [/resource "aws_instance" "app" \{[\s\S]*?\n}\n\n/, ''],
        [/resource "aws_lb_target_group_attachment" "app" \{[\s\S]*?\n}\n/, SEPARATE(subnetB)],
      ),
    );

  it('accepts two separate server blocks, one per zone', () => {
    expect(withServers('aws_subnet.private[1].id')).toMatchObject({ servers: true, health: true, chain: true });
  });

  it('catches both servers in one zone, or in the public subnets', () => {
    expect(withServers('aws_subnet.private[0].id')).toMatchObject({ servers: false });
    expect(goals('tier-app', edit('tier-app', 'app.tf', ['aws_subnet.private[count.index].id', 'aws_subnet.public[count.index].id']))).toMatchObject({ servers: false });
  });

  it('catches an address range where the load balancer\'s group belongs', () => {
    const files = edit('tier-app', 'app.tf', ['security_groups = [aws_security_group.alb.id]', 'cidr_blocks     = ["10.0.0.0/16"]']);
    expect(goals('tier-app', files)).toMatchObject({ alb: true, chain: false });
  });
});

const FLEET = `resource "aws_launch_template" "app" {
  image_id               = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.app.id]

  metadata_options {
    http_tokens = "required"
  }
}

resource "aws_autoscaling_group" "app" {
  min_size            = 2
  max_size            = 4
  vpc_zone_identifier = aws_subnet.private[*].id
  target_group_arns   = [aws_lb_target_group.app.arn]

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }
}
`;

/** a lesson's solution with its `count` servers and their attachments traded for an auto scaling group */
const withFleet = (slug: string) =>
  edit(slug, 'app.tf', [/resource "aws_instance" "app" \{[\s\S]*?\n}\n\n/, ''], [/resource "aws_lb_target_group_attachment" "app" \{[\s\S]*?\n}\n/, FLEET]);

describe('an auto scaling group in place of the instances', () => {
  it('passes the app tier and the budget, the fleet priced at its size', () => {
    expect(goals('tier-app', withFleet('tier-app'))).toMatchObject({ alb: true, servers: true, health: true, listener: true, chain: true });
    expect(goals('challenge-secure-three-tier', withFleet('challenge-secure-three-tier'))).toMatchObject({ budget: true, grade: true });
  });
});

describe('7.9: the data tier', () => {
  const password = (decl: string, arg: string) =>
    goals('tier-database', {
      ...edit('tier-database', 'database.tf', ['manage_master_user_password = true', arg]),
      'variables.tf': decl,
    });

  it('accepts a sensitive variable, not a plain one or a pasted password', () => {
    expect(password('variable "db_password" {\n  type      = string\n  sensitive = true\n}\n', 'password = var.db_password')).toMatchObject({ password: true });
    expect(password('variable "db_password" {\n  type = string\n}\n', 'password = var.db_password')).toMatchObject({ password: false });
    expect(password('', 'password = "hunter2hunter2"')).toMatchObject({ password: false });
  });

  it('catches a database open to an address range', () => {
    const files = edit('tier-database', 'database.tf', ['security_groups = [aws_security_group.app.id]', 'cidr_blocks     = ["10.0.0.0/16"]']);
    expect(goals('tier-database', files)).toMatchObject({ subnets: true, 'only-app': false, safe: true });
  });
});

describe('C7: production, on a budget', () => {
  const challenge = 'challenge-secure-three-tier';

  // the estimate leaves a resource behind a switch out of its total (0 or 1, decided at plan time), so the NAT switch can't bust it
  it('busts the budget with a Multi-AZ db.t3.small, bigger servers, or a server missing', () => {
    expect(goals(challenge, edit(challenge, 'database.tf', ['"db.t3.micro"', '"db.t3.small"']))).toMatchObject({ zones: true, budget: false });
    expect(goals(challenge, edit(challenge, 'app.tf', ['"t3.micro"', '"t3.medium"']))).toMatchObject({ budget: false });
    expect(goals(challenge, edit(challenge, 'app.tf', [/count {18}= length\(local\.zones\)/, 'count                  = 1']))).toMatchObject({ budget: false });
  });

  it('wants the certificate from a variable, and port 80 redirecting', () => {
    expect(goals(challenge, edit(challenge, 'app.tf', ['certificate_arn   = var.certificate_arn', 'certificate_arn   = "arn:aws:acm:us-east-1:123456789012:certificate/abc"']))).toMatchObject({ https: false });
    const forward = edit(challenge, 'app.tf', [
      /type = "redirect"\n\n {4}redirect \{[\s\S]*?\n {4}}/,
      'type             = "forward"\n    target_group_arn = aws_lb_target_group.app.arn',
    ]);
    expect(goals(challenge, forward)).toMatchObject({ https: false, grade: true });
  });

  it('keeps the database closed while everything else changes', () => {
    expect(goals(challenge, edit(challenge, 'database.tf', ['publicly_accessible    = false', 'publicly_accessible    = true']))).toMatchObject({ 'only-app': false, grade: false });
  });
});
