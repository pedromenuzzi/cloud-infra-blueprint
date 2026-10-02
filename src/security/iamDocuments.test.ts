import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { auditSecurity } from './audit';
import { wildcardStatements } from './iamDocuments';

const doc = (statement: string, name = 'admin') => `data "aws_iam_policy_document" "${name}" {
${statement}
}
`;
const ROLE = `resource "aws_iam_policy" "p" {
  name   = "p"
  policy = data.aws_iam_policy_document.admin.json
}
`;
const STAR = `  statement {
    actions   = ["*"]
    resources = ["*"]
  }`;

const audit = (main: string) => auditSecurity(parseProject({ 'main.tf': main }).ir);

afterEach(() => useLocale.getState().setLocale('en'));

describe('IAM policy documents in the security audit', () => {
  it('flags a used statement that allows "*" on "*", pointing at the document', () => {
    const result = audit(doc(STAR) + ROLE);
    const finding = result.findings.find((f) => f.id.startsWith('iam-admin:'))!;
    expect(finding).toMatchObject({
      severity: 'high',
      title: 'IAM policy allows every action on every resource',
      resource: 'data.aws_iam_policy_document.admin',
      related: ['aws_iam_policy.p'],
    });
    expect(finding.detail).toBe(
      'Statement 1 of data.aws_iam_policy_document.admin allows "*" on "*", full administrator access, and aws_iam_policy.p uses it. List the actions it needs (s3:GetObject, for example) and the ARNs they act on instead.',
    );
    // a project of policies alone gets a grade once one grants too much
    expect(result.grade).not.toBeNull();
  });

  it('finds the statement among several, and "*:*" too', () => {
    const two = `  statement {
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::b/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["*:*"]
    resources = ["*"]
  }`;
    const { ir } = parseProject({ 'main.tf': doc(two) + ROLE });
    expect(wildcardStatements(ir).map((w) => w.index)).toEqual([1]);
  });

  it('leaves alone what it cannot be sure of, or what grants nothing', () => {
    const cases = [
      // denied, scoped, conditional, written with expressions or with not_*: not "*" on "*" for sure
      `  statement {\n    effect    = "Deny"\n    actions   = ["*"]\n    resources = ["*"]\n  }`,
      `  statement {\n    actions   = ["*"]\n    resources = ["arn:aws:s3:::b"]\n  }`,
      `  statement {\n    actions   = ["s3:*"]\n    resources = ["*"]\n  }`,
      `  statement {\n    actions   = ["*"]\n    resources = ["*"]\n\n    condition {\n      test     = "Bool"\n      variable = "aws:MultiFactorAuthPresent"\n      values   = ["true"]\n    }\n  }`,
      `  statement {\n    actions   = var.actions\n    resources = ["*"]\n  }`,
      `  statement {\n    not_actions = ["iam:*"]\n    actions     = ["*"]\n    resources   = ["*"]\n  }`,
    ];
    for (const c of cases) expect(audit(doc(c) + ROLE).findings.filter((f) => f.id.startsWith('iam-admin:')), c).toEqual([]);
    // nothing reads the document: it grants nothing
    expect(audit(doc(STAR)).findings).toEqual([]);
  });

  it('in Portuguese', () => {
    useLocale.getState().setLocale('pt-BR');
    const finding = audit(doc(STAR) + ROLE).findings.find((f) => f.id.startsWith('iam-admin:'))!;
    expect(finding.title).toBe('Política do IAM permite todas as ações em todos os recursos');
    expect(finding.key).toBe('IAM policy allows every action on every resource');
    expect(finding.detail).toContain('A declaração 1 de data.aws_iam_policy_document.admin permite "*" em "*"');
  });
});
