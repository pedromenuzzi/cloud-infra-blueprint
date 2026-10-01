import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { auditSecurity } from './audit';
import { auditModules, projectAudit } from './modules';
import { analyzeSecurity } from './topology';

const BASTION = {
  'modules/bastion/main.tf': `resource "aws_security_group" "ssh" {
  name = "ssh"
  ingress {
    from_port   = var.port
    to_port     = var.port
    protocol    = "tcp"
    cidr_blocks = [var.cidr]
  }
}

resource "aws_instance" "box" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.ssh.id]
}

variable "cidr" {}
variable "port" {
  default = 22
}
`,
};

function project(main: string) {
  const files = { 'main.tf': main, ...BASTION };
  const { ir } = parseProject(files);
  return { files, ir, own: auditSecurity(ir, analyzeSecurity(ir, 'en')) };
}

describe('the audit of local modules', () => {
  it('audits each call with its literal inputs, labelled with the module path', () => {
    const { files, ir, own } = project(`module "bastion" {
  source = "./modules/bastion"
  cidr   = "0.0.0.0/0"
}

module "private" {
  source = "./modules/bastion"
  cidr   = "10.0.0.0/8"
}
`);
    const { findings } = auditModules(ir, files, 'en');
    const ssh = findings.find((f) => f.finding.id.startsWith('rule:'))!;
    expect(ssh.label).toBe('module.bastion › aws_security_group.ssh');
    expect(ssh.finding.severity).toBe('critical');
    expect(ssh.module.steps).toEqual([{ dir: 'modules/bastion', name: 'bastion' }]);
    // the private call opens nothing to the internet
    expect(findings.some((f) => f.module.id === 'module.private' && f.finding.id.startsWith('rule:'))).toBe(false);
    // the root has nothing to audit of its own: the grade is the modules'
    expect(own.grade).toBeNull();
    const all = projectAudit(own, ir, files);
    expect(all.counts.critical).toBeGreaterThan(0);
    expect(all.grade).not.toBeNull();
    expect(all.grade).not.toBe('A');
  });

  it('says when a finding reads an input the call gives as an expression', () => {
    const { files, ir } = project(`module "bastion" {
  source = "./modules/bastion"
  cidr   = "0.0.0.0/0"
  port   = local.ssh_port
}
`);
    const { findings } = auditModules(ir, files, 'pt-BR');
    const rule = findings.find((f) => f.finding.resource === 'aws_security_group.ssh')!;
    expect(rule.finding.unverified).toBe(true);
    expect(rule.inputs.map((i) => [i.name, i.value])).toEqual([['port', 'local.ssh_port']]);
    expect(rule.inputs[0].note).toContain('var.port vem de uma entrada');
  });

  it('leaves the plain audit alone without local modules', () => {
    const { files, ir, own } = project(`module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n`);
    expect(projectAudit(own, ir, files)).toEqual({ own, modules: [], counts: own.counts, score: own.score, grade: own.grade });
  });
});
