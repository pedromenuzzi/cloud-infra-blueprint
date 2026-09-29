import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { isContainerType } from '@/resources/registry';
import { autoLayout, NODE_H, NODE_W } from './layout';
import { deriveStructure } from './graph';
import { getDef } from '@/resources/registry';

const box = (p: { x: number; y: number; w?: number; h?: number }) => ({ x: p.x, y: p.y, w: p.w ?? NODE_W, h: p.h ?? NODE_H });
const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function laidOut(main: string) {
  const { ir } = parseProject({ 'main.tf': main });
  deriveStructure(ir, getDef);
  autoLayout(ir, isContainerType);
  return new Map(ir.resources.map((r) => [r.id, r] as const));
}

describe('autoLayout for resources typed in code', () => {
  it("puts a new child next to its placed siblings, not on top of them", () => {
    const byId = laidOut(`# @blueprint:pos=40,40,680,400
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
# @blueprint:pos=28,44,400,200
resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
# @blueprint:pos=28,44
resource "aws_instance" "web" {
  subnet_id = aws_subnet.a.id
}
resource "aws_instance" "typed" {
  subnet_id = aws_subnet.a.id
}
`);
    const web = box(byId.get('aws_instance.web')!.position!);
    const typed = box(byId.get('aws_instance.typed')!.position!);
    expect(overlap(web, typed)).toBe(false);
    const subnet = byId.get('aws_subnet.a')!.position!;
    expect(typed.x + typed.w).toBeLessThanOrEqual(subnet.w!);
  });

  it('puts new top-level resources below everything on the canvas', () => {
    const byId = laidOut(`# @blueprint:pos=40,40,680,400
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
# @blueprint:pos=760,120
resource "aws_security_group" "sg" {
  name = "sg"
}
resource "aws_sqs_queue" "jobs" {
}
resource "aws_sns_topic" "events" {
}
`);
    const vpc = box(byId.get('aws_vpc.main')!.position!);
    for (const id of ['aws_sqs_queue.jobs', 'aws_sns_topic.events']) {
      const b = box(byId.get(id)!.position!);
      expect(b.y, id).toBeGreaterThanOrEqual(vpc.y + vpc.h);
      expect(overlap(b, box(byId.get('aws_security_group.sg')!.position!)), id).toBe(false);
    }
  });
});
