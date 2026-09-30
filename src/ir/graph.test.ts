import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { getDef } from '@/resources/registry';
import { deriveStructure } from './graph';

const network = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_vpc" "other" {
  cidr_block = "10.1.0.0/16"
}
resource "aws_subnet" "a" {
  vpc_id = aws_vpc.main.id
}
resource "aws_subnet" "b" {
  vpc_id = aws_vpc.main.id
}
resource "aws_subnet" "x" {
  vpc_id = aws_vpc.other.id
}
`;

function derive(extra: string) {
  const { ir } = parseProject({ 'main.tf': network + extra });
  const edges = deriveStructure(ir, getDef);
  return { byId: new Map(ir.resources.map((r) => [r.id, r] as const)), edges };
}

describe('containment through references (via)', () => {
  it('draws a DB subnet group in the VPC of its subnets, and the database inside the group', () => {
    const { byId, edges } = derive(`resource "aws_db_subnet_group" "db" {
  subnet_ids = [aws_subnet.a.id, aws_subnet.b.id]
}
resource "aws_db_instance" "main" {
  instance_class       = "db.t3.micro"
  db_subnet_group_name = aws_db_subnet_group.db.name
}
`);
    expect(byId.get('aws_db_subnet_group.db')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_db_instance.main')?.parentId).toBe('aws_db_subnet_group.db');
    // nesting replaces the database → group edge; the group still points at its subnets
    expect(edges.map((e) => e.id)).not.toContain('aws_db_instance.main->aws_db_subnet_group.db:db_subnet_group_name');
    expect(edges.filter((e) => e.source === 'aws_db_subnet_group.db').map((e) => e.target)).toEqual([
      'aws_subnet.a',
      'aws_subnet.b',
    ]);
  });

  it('stays on the top level when its subnets are in different VPCs, or none are listed', () => {
    const { byId } = derive(`resource "aws_db_subnet_group" "split" {
  subnet_ids = [aws_subnet.a.id, aws_subnet.x.id]
}
resource "aws_db_subnet_group" "empty" {
  subnet_ids = []
}
resource "aws_elasticache_subnet_group" "cache" {
  name       = "cache"
  subnet_ids = [aws_subnet.x.id]
}
`);
    expect(byId.get('aws_db_subnet_group.split')?.parentId).toBeUndefined();
    expect(byId.get('aws_db_subnet_group.empty')?.parentId).toBeUndefined();
    expect(byId.get('aws_elasticache_subnet_group.cache')?.parentId).toBe('aws_vpc.other');
  });
});
