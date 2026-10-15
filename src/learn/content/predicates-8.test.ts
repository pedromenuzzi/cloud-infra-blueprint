/**
 * The level 8 goals against what learners really write: the backend in
 * main.tf with its arguments shuffled, the older DynamoDB lock, a variable
 * named `env`, a whole-object sensitive output, Secrets Manager instead of
 * SSM, an import id typed while the bucket name is a template; and what they
 * must still catch (a variable in the backend, a secret in a .tfvars file, a
 * leftover "dev", `destroy = true`, the plan of Ana's pull request as written).
 */
import { describe, expect, it } from 'vitest';
import { checkGoals, lessonContext } from '../goals';
import { getLesson } from '../lessons';
import { simulate } from '../sim/simulate';
import type { Files, SimCommand, SimState } from '../types';
import { aws } from './shared';

const EVERY: SimCommand[] = ['init', 'validate', 'plan', 'apply'];

/** goal id → met */
function met(slug: string, files: Files, ran: SimCommand[] = [], state: SimState | null = null): Record<string, boolean> {
  const lesson = getLesson(slug)!;
  const results = checkGoals(lesson.goals, lessonContext(files, { ran, state }));
  return Object.fromEntries(lesson.goals.map((g, i) => [g.id, results[i]]));
}

/** the state an apply of `files` leaves, from `previous` */
function apply(files: Files, previous: SimState | null = null): SimState {
  const result = simulate('apply', files, previous, { initialized: true, autoApprove: true });
  expect(result.ok, result.lines.map((l) => l.text).join('\n')).toBe(true);
  return result.state!;
}

const edit = (files: Files, file: string, from: string | RegExp, to: string): Files => {
  expect(files[file]).toMatch(from);
  return { ...files, [file]: files[file].replace(from, to) };
};

describe('8.1 remote state', () => {
  const lesson = getLesson('remote-state')!;
  const main = lesson.solution['main.tf'];

  it('accepts the backend in main.tf, arguments in any order, and the DynamoDB lock', () => {
    const files = aws(
      `${main.slice(main.indexOf('resource "aws_s3_bucket" "state"'))}
terraform {
  # the state of this very project
  backend "s3" {
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
    key            = "global/state.tfstate"
    bucket         = "acme-terraform-state"
  }
}
`,
    );
    expect(met('remote-state', files, EVERY, apply(files))).toEqual({
      versioned: true,
      private: true,
      guarded: true,
      bootstrap: true,
      backend: true,
      locked: true,
    });
  });

  it('wants plain strings, a lock, and the bucket this code creates', () => {
    const backend = lesson.solution['backend.tf'];
    expect(met('remote-state', { ...lesson.solution, 'backend.tf': backend.replace('"acme-terraform-state"', 'var.state_bucket') }).backend).toBe(false);
    expect(met('remote-state', { ...lesson.solution, 'backend.tf': backend.replace('"acme-terraform-state"', '"someone-elses-bucket"') }).backend).toBe(false);
    expect(met('remote-state', { ...lesson.solution, 'backend.tf': backend.replace(/\s*use_lockfile = true/, '') }, ['init']).locked).toBe(false);
    expect(met('remote-state', lesson.solution, []).locked).toBe(false);
  });

  it('starts with nothing done', () => {
    expect(Object.values(met('remote-state', lesson.start)).some(Boolean)).toBe(false);
  });
});

describe('8.2 environments', () => {
  const lesson = getLesson('environments')!;

  it('accepts a variable named env, a local for the prefix and extra values in the files', () => {
    const files: Files = {
      ...lesson.solution,
      'main.tf': lesson.solution['main.tf'].replaceAll('var.environment', 'local.prefix').replaceAll('${local.prefix}', '${var.env}').replace(
        'resource "aws_s3_bucket"',
        'locals {\n  prefix = var.env\n}\n\nresource "aws_s3_bucket"',
      ),
      'variables.tf': lesson.solution['variables.tf'].replace('variable "environment"', 'variable "env"'),
      'dev.tfvars': 'env           = "development"\ninstance_type = "t3.micro"\n',
      'prod.tfvars': 'env           = "production"\ninstance_type = "t3.large"\n',
    };
    expect(met('environments', files, EVERY)).toEqual({ vars: true, names: true, dev: true, prod: true, plan: true });
  });

  it('catches a leftover "dev", an undeclared name, and prod files that only rename', () => {
    expect(met('environments', edit(lesson.solution, 'main.tf', 'Name        = "shop-${var.environment}-app"', 'Name        = "shop-dev-app"')).names).toBe(false);
    expect(met('environments', { ...lesson.solution, 'dev.tfvars': `${lesson.solution['dev.tfvars']}region = "us-east-1"\n` }).dev).toBe(false);
    expect(met('environments', { ...lesson.solution, 'prod.tfvars': 'environment   = "prod"\ninstance_type = "t3.micro"\n' }).prod).toBe(false);
    expect(met('environments', { ...lesson.solution, 'dev.tfvars': lesson.solution['prod.tfvars'] }).dev).toBe(false);
  });

  it('leaves the .tfvars files out of the code the canvas draws', () => {
    expect(lessonContext(lesson.solution).errored).toBe(false);
  });
});

describe('8.3 sensitive values', () => {
  const lesson = getLesson('sensitive-values')!;
  const main = lesson.solution['main.tf'];

  it('accepts one sensitive object output and Secrets Manager', () => {
    const files = aws(`data "aws_secretsmanager_secret_version" "payments" {
  secret_id = "shop/payments"
}

${main.slice(main.indexOf('resource "aws_db_instance"'), main.indexOf('output "db_host"'))}
output "app_settings" {
  value = {
    db_host          = aws_db_instance.main.address
    payments_api_key = data.aws_secretsmanager_secret_version.payments.secret_string
  }
  sensitive = true
}
`);
    expect(met('sensitive-values', files, EVERY, apply(files))).toEqual({ managed: true, typed: true, ssm: true, sensitive: true, apply: true });
  });

  it('catches an unmarked output, a sensitive variable flowing out, and a secret in a .tfvars file', () => {
    expect(met('sensitive-values', edit(lesson.solution, 'main.tf', /\n {2}sensitive = true/, '')).sensitive).toBe(false);
    const viaVariable = aws(`variable "alerts_token" {
  type      = string
  sensitive = true
  default   = null
}

output "token" {
  value = var.alerts_token
}
`);
    expect(met('sensitive-values', viaVariable).sensitive).toBe(false);
    expect(met('sensitive-values', { ...lesson.solution, 'secrets.tfvars': 'payments_api_key = "pk_live_1"\n' }).typed).toBe(false);
    expect(met('sensitive-values', edit(lesson.solution, 'main.tf', 'manage_master_user_password = true', 'password = "hunter2"'))).toMatchObject({ managed: false, typed: false });
  });

  it('a variable without its default is no secret in the code', () => {
    expect(met('sensitive-values', edit(lesson.start, 'main.tf', /\n {2}default {5}= "Sup3r-Secret-2026"/, '')).typed).toBe(false);
    const both = edit(edit(lesson.start, 'main.tf', /\n {2}default {5}= "Sup3r-Secret-2026"/, ''), 'main.tf', /\n {2}default {5}= "pk_live_51Hx9aQ2"/, '');
    expect(met('sensitive-values', both).typed).toBe(true);
  });
});

describe('8.4 lifecycle rules', () => {
  const lesson = getLesson('lifecycle-rules')!;

  it('walks the lesson: apply, the guarded move fails, the rules, apply, a quiet plan', () => {
    const started = apply(lesson.start);
    const moveZone = edit(lesson.solution, 'main.tf', 'storage_encrypted ', 'availability_zone           = "us-east-1b"\n  storage_encrypted ');
    expect(simulate('plan', moveZone, started).lines.map((l) => l.text).join('\n')).toContain('Instance cannot be destroyed');
    expect(met('lifecycle-rules', moveZone, EVERY, started).synced).toBe(false);
    expect(met('lifecycle-rules', lesson.solution, EVERY, started)).toMatchObject({ running: true, protect: true, synced: false });
    const done = apply(lesson.solution, started);
    expect(Object.values(met('lifecycle-rules', lesson.solution, EVERY, done)).every(Boolean)).toBe(true);
  });

  it('accepts the rules in any order, `ignore_changes = all` and a whole-resource trigger', () => {
    const files = edit(
      lesson.solution,
      'main.tf',
      /lifecycle \{\n {4}create_before_destroy[\s\S]*?\n {2}\}/,
      'lifecycle {\n    replace_triggered_by  = [aws_launch_template.web]\n    ignore_changes        = all\n    create_before_destroy = true\n  }',
    );
    expect(met('lifecycle-rules', files)).toMatchObject({ ignore: true, trigger: true, before: true });
  });

  it('wants name_prefix once the group is created before it is destroyed', () => {
    expect(met('lifecycle-rules', edit(lesson.solution, 'main.tf', 'name_prefix        = "web-"', 'name               = "web"')).before).toBe(false);
  });
});

describe('8.5 import existing', () => {
  const lesson = getLesson('import-existing')!;

  it('walks the lesson: apply the reports bucket, hand it over, adopt the invoices', () => {
    const started = apply(lesson.start);
    expect(met('import-existing', lesson.solution, EVERY, started).apply).toBe(false);
    const done = apply(lesson.solution, started);
    expect(Object.values(met('import-existing', lesson.solution, EVERY, done)).every(Boolean)).toBe(true);
  });

  it('catches destroy = true, an id that is not the bucket, and an import into nothing', () => {
    expect(met('import-existing', edit(lesson.solution, 'main.tf', 'destroy = false', 'destroy = true')).handover).toBe(false);
    expect(met('import-existing', edit(lesson.solution, 'main.tf', 'id = "acme-invoices-2023"', 'id = "acme-invoices"')).import).toBe(false);
    expect(met('import-existing', edit(lesson.solution, 'main.tf', 'to = aws_s3_bucket.invoices', 'to = aws_s3_bucket.billing')).import).toBe(false);
  });
});

describe('8.6 reviewing plans', () => {
  const lesson = getLesson('reviewing-plans')!;
  const ana = edit(
    edit(
      edit(edit(lesson.start, 'main.tf', '= "db.t4g.micro"', '= "db.t4g.small"'), 'main.tf', '= 20', '= 50'),
      'main.tf',
      'username                    = "shop"',
      'username                    = "shop_admin"',
    ),
    'main.tf',
    'resource "aws_s3_bucket" "assets"',
    'resource "aws_s3_bucket" "static_assets"',
  );

  it('sees the damage in Ana\'s pull request as written, and none once reviewed', () => {
    const production = apply(lesson.start);
    expect(met('reviewing-plans', ana, EVERY, production)).toMatchObject({ prod: true, sizing: true, rename: true, safe: false });
    const halfway = edit(lesson.solution, 'main.tf', 'username                    = "shop"', 'username                    = "shop_admin"');
    expect(met('reviewing-plans', halfway, EVERY, production).safe).toBe(false);
    expect(met('reviewing-plans', lesson.solution, EVERY, production)).toMatchObject({ safe: true, shipped: false });
    const shipped = apply(lesson.solution, production);
    expect(Object.values(met('reviewing-plans', lesson.solution, EVERY, shipped)).every(Boolean)).toBe(true);
  });

  it('a plan before production exists proves nothing', () => {
    expect(met('reviewing-plans', lesson.solution, EVERY).safe).toBe(false);
  });
});

describe('C8 production ready', () => {
  const lesson = getLesson('challenge-production-ready')!;

  it('accepts a typed import id that matches the templated name, and its own file layout', () => {
    const main = lesson.solution['main.tf'];
    const files: Files = {
      ...lesson.solution,
      'main.tf': main.replace('id = "acme-shop-${var.environment}-media"', 'id = "acme-shop-dev-media"').replace(/\noutput[\s\S]*$/, '\n'),
      'outputs.tf': main.slice(main.indexOf('output "db_host"')),
    };
    const results = met('challenge-production-ready', files, EVERY, apply(files));
    expect(results).toEqual({ backend: true, envs: true, secrets: true, protect: true, import: true, review: true });
  });

  it('catches a leftover environment name and a secret output left plain', () => {
    expect(met('challenge-production-ready', edit(lesson.solution, 'main.tf', '"acme-shop-${var.environment}-uploads"', '"acme-shop-prod-uploads"')).envs).toBe(false);
    expect(met('challenge-production-ready', edit(lesson.solution, 'main.tf', /\n {2}sensitive = true/, '')).secrets).toBe(false);
  });
});
