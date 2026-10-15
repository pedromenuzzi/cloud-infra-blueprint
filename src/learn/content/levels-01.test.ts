/**
 * Levels 0 and 1 against what learners really write: what the canvas drops,
 * quoted numbers, references made three ways, terminal runs in between.
 */
import { expect, it } from 'vitest';
import { checkGoals, lessonContext } from '../goals';
import { getLesson } from '../lessons';
import type { Files, SimCommand, SimState } from '../types';
import { aws } from './shared';

const state = (...addresses: string[]): SimState => ({ serial: 1, resources: Object.fromEntries(addresses.map((a) => [a, {}])), outputs: {} });
const met = (slug: string, files: Files, ran: SimCommand[] = [], st: SimState | null = null) => {
  const lesson = getLesson(slug)!;
  const results = checkGoals(lesson.goals, lessonContext(files, { ran, state: st }));
  return Object.fromEntries(lesson.goals.map((g, i) => [g.id, results[i]]));
};

it('0.2: the dropped bucket, then renamed and named', () => {
  expect(met('first-resource', aws('resource "aws_s3_bucket" "bucket" {}\n'))).toMatchObject({ bucket: true, label: false, name: false });
  expect(met('first-resource', aws('resource "aws_s3_bucket" "photos" {\n  bucket = "My_Photos"\n}\n'))).toMatchObject({ label: true, name: false });
});

it('0.3: quoted numbers and booleans are strings', () => {
  const typed = aws('resource "aws_sqs_queue" "queue" {\n  name = "queue"\n  fifo_queue = "true"\n  message_retention_seconds = "86400"\n}\n');
  expect(met('arguments-and-types', typed)).toMatchObject({ queue: true, number: false, boolean: false, string: false });
});

it('0.5: the security fix and the inspector picker write the same reference', () => {
  const fixed = aws(`resource "aws_s3_bucket" "photos" {\n  bucket = "photos-demo-2026"\n}\nresource "aws_s3_bucket_public_access_block" "photos" {\n  bucket = aws_s3_bucket.photos.id\n  block_public_acls = true\n  block_public_policy = true\n  ignore_public_acls = true\n  restrict_public_buckets = true\n}\nresource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\nresource "aws_subnet" "subnet" {\n  vpc_id = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\n`);
  expect(met('references', fixed)).toMatchObject({ block: true, subnet: true, apply: false });
});

it('0.6: the last goal needs the edits and a fresh apply', () => {
  const lesson = getLesson('plan-apply-cycle')!;
  const first = state('aws_s3_bucket.photos', 'aws_s3_bucket.temp');
  // right after the first apply only the first goal is met
  expect(met('plan-apply-cycle', lesson.start, ['init', 'apply'], first)).toEqual({ apply: true, update: false, replace: false, destroy: false, sync: false });
  // all edits made, not applied yet
  expect(met('plan-apply-cycle', lesson.solution, ['init', 'apply', 'plan'], first)).toMatchObject({ update: true, replace: true, destroy: true, sync: false });
  // applied again
  expect(met('plan-apply-cycle', lesson.solution, ['init', 'apply', 'plan'], state('aws_s3_bucket.photos'))).toMatchObject({ sync: true });
  // deleting `photos` instead of `temp` doesn't count as a replacement
  const wrong = aws('resource "aws_s3_bucket" "temp" {\n  bucket = "temp-demo-2026"\n}\n');
  expect(met('plan-apply-cycle', wrong, ['plan'])).toMatchObject({ replace: false, destroy: false });
});

it('1.2: `var.x` typed in the inspector field counts', () => {
  const files = { ...aws('resource "aws_s3_bucket" "site" {\n  bucket = var.environment\n  tags = {\n    Environment = var.environment\n  }\n}\n'), 'variables.tf': 'variable "environment" {\n  type = string\n  default = "dev"\n}\n' };
  expect(met('variables', files, ['plan'])).toEqual({ declare: true, tag: true, name: true, plan: true });
});

it('1.3: merged tags and both buckets required', () => {
  const lesson = getLesson('locals')!;
  const half = lesson.start['main.tf'].replace(/tags = \{[^}]*\}/, 'tags = merge(local.common_tags, { Name = "site" })');
  expect(met('locals', { ...lesson.start, 'main.tf': `locals {\n  common_tags = {}\n}\n${half}` })).toMatchObject({ locals: true, tags: false });
  const both = lesson.start['main.tf'].replace(/tags = \{[^}]*\}/g, 'tags = merge(local.common_tags, { Name = "x" })');
  expect(met('locals', { ...lesson.start, 'main.tf': `locals {\n  common_tags = {}\n}\n${both}` })).toMatchObject({ tags: true, names: false });
});

it('1.4 and C1: outputs by id, names through a local, literals refused', () => {
  const out = { ...getLesson('outputs')!.start, 'outputs.tf': 'output "name" {\n  value = aws_s3_bucket.site.id\n}\n' };
  expect(met('outputs', out)).toMatchObject({ name: true, arn: false });
  const viaLocal = {
    ...aws('locals {\n  name = "acme-${var.env}-backups"\n}\nresource "aws_s3_bucket" "b" {\n  bucket = local.name\n}\n'),
    'variables.tf': 'variable "env" {\n  default = "dev"\n}\n',
  };
  expect(met('challenge-private-bucket', viaLocal)).toMatchObject({ variable: true, versioned: false, private: false });
  expect(met('challenge-private-bucket', aws('resource "aws_s3_bucket" "b" {\n  bucket = "fixed-name"\n}\n'))).toMatchObject({ variable: false });
});
