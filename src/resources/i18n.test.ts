import { afterEach, describe, expect, it } from 'vitest';
import { useLocale } from '@/i18n/locale';
import { lit } from '@/ir/expr';
import type { Expression, ResourceNode } from '@/ir/types';
import { CATALOG_PT_BR } from './catalog.messages';
import { fieldBoundsDiagnostics } from './fieldRules';
import { categoryLabel, fieldHelp, resourceDescription, resourceName, resourceShortName, resourceSubtitle } from './i18n';
import { allDefs, getDef } from './registry';
import { CATEGORY_LABELS, CATEGORY_ORDER } from './types';

afterEach(() => useLocale.getState().setLocale('en'));

describe('catalog text per language', () => {
  it('has a Portuguese name, short name and description for every catalog type', () => {
    const defs = allDefs();
    expect(defs.length).toBeGreaterThan(90);
    for (const def of defs) {
      const pt = CATALOG_PT_BR[def.type as keyof typeof CATALOG_PT_BR];
      expect(pt, def.type).toBeDefined();
      expect(pt.name.trim(), def.type).not.toBe('');
      expect(pt.shortName.trim(), def.type).not.toBe('');
      expect(pt.description.trim(), def.type).not.toBe('');
      expect(resourceName(def.type, 'pt-BR')).toBe(pt.name);
      expect(resourceShortName(def.type, 'pt-BR')).toBe(pt.shortName);
      expect(resourceDescription(def.type, 'pt-BR')).toBe(pt.description);
    }
    // and nothing for types the catalog doesn't have
    expect(Object.keys(CATALOG_PT_BR).sort()).toEqual(defs.map((d) => d.type).sort());
  });

  it('translates the field help one for one with the defs', () => {
    for (const def of allDefs()) {
      const pt = CATALOG_PT_BR[def.type as keyof typeof CATALOG_PT_BR];
      const helped = def.fields.filter((f) => f.label !== undefined || f.doc !== undefined);
      expect(Object.keys(pt.fields ?? {}).sort(), def.type).toEqual(helped.map((f) => f.name).sort());
      for (const field of helped) {
        const text = pt.fields![field.name];
        expect(text.label !== undefined, `${def.type}.${field.name} label`).toBe(field.label !== undefined);
        expect(text.doc !== undefined, `${def.type}.${field.name} doc`).toBe(field.doc !== undefined);
        expect(fieldHelp(def.type, field.name, 'pt-BR')).toEqual({ label: text.label, doc: text.doc, placeholder: field.placeholder });
        expect(fieldHelp(def.type, field.name, 'en')).toEqual({ label: field.label, doc: field.doc, placeholder: field.placeholder });
      }
    }
  });

  it('keeps English as the catalog source and follows the language in effect', () => {
    expect(resourceName('aws_instance')).toBe('EC2 Instance');
    expect(resourceShortName('aws_subnet')).toBe('Subnet');
    expect(resourceDescription('aws_instance')).toBe('Virtual machine');
    expect(fieldHelp('aws_db_instance', 'vpc_security_group_ids').label).toBe('Security groups');
    useLocale.getState().setLocale('pt-BR');
    expect(resourceName('aws_instance')).toBe('Instância EC2');
    expect(resourceShortName('aws_subnet')).toBe('Sub-rede');
    expect(resourceName('aws_security_group')).toBe('Grupo de segurança');
    expect(resourceName('aws_s3_bucket')).toBe('Bucket S3');
    expect(resourceName('aws_lambda_function')).toBe('Função Lambda');
    expect(resourceName('aws_route_table')).toBe('Tabela de rotas');
    expect(resourceName('aws_lb')).toBe('Application Load Balancer');
    expect(resourceDescription('aws_instance')).toBe('Máquina virtual');
    expect(fieldHelp('aws_db_instance', 'vpc_security_group_ids').label).toBe('Grupos de segurança');
    expect(fieldHelp('aws_s3_bucket', 'bucket').placeholder).toBe('my-unique-bucket-name');
    // the defs themselves never change
    expect(getDef('aws_instance')!.displayName).toBe('EC2 Instance');
    // unknown types fall back to the type
    expect(resourceName('aws_something_new')).toBe('aws_something_new');
    expect(resourceDescription('aws_something_new')).toBeUndefined();
    expect(fieldHelp('aws_instance', 'no_such_field')).toEqual({});
  });

  it('labels every category in both languages', () => {
    for (const c of CATEGORY_ORDER) {
      expect(categoryLabel(c, 'en')).toBe(CATEGORY_LABELS[c]);
      expect(categoryLabel(c, 'pt-BR')).not.toBe('');
    }
    expect(categoryLabel('compute', 'pt-BR')).toBe('Computação');
    expect(categoryLabel('identity', 'pt-BR')).toBe('Segurança e identidade');
    expect(categoryLabel('integration', 'pt-BR')).toBe('Mensageria e APIs');
  });

  it('computes canvas subtitles in the requested language', () => {
    const sg: Record<string, Expression> = { ingress: { kind: 'blocks', items: [{}, {}] }, egress: { kind: 'block', body: {} } };
    expect(resourceSubtitle('aws_security_group', sg, 'en')).toBe('2 inbound · 1 outbound');
    expect(resourceSubtitle('aws_security_group', sg, 'pt-BR')).toBe('2 de entrada · 1 de saída');
    expect(resourceSubtitle('aws_security_group', {}, 'pt-BR')).toBe('sem regras inline');
    expect(resourceSubtitle('aws_dynamodb_table', {}, 'pt-BR')).toBe('sob demanda');
    expect(resourceSubtitle('aws_vpc_security_group_ingress_rule', { from_port: lit(443) }, 'en')).toBe('tcp :443 in');
    expect(resourceSubtitle('aws_vpc_security_group_ingress_rule', { from_port: lit(443) }, 'pt-BR')).toBe('entrada tcp :443');
    expect(resourceSubtitle('aws_vpc_security_group_egress_rule', { ip_protocol: lit('-1') }, 'en')).toBe('all out');
    expect(resourceSubtitle('aws_vpc_security_group_egress_rule', { ip_protocol: lit('-1') }, 'pt-BR')).toBe('toda a saída');
    expect(resourceSubtitle('aws_db_subnet_group', {}, 'pt-BR')).toBe('0 sub-redes');
    expect(resourceSubtitle('aws_instance', { instance_type: lit('t3.micro') }, 'pt-BR')).toBe('t3.micro');
    // without a locale: the one in effect
    useLocale.getState().setLocale('pt-BR');
    expect(getDef('aws_iam_role')!.subtitle!({})).toBe('perfil do IAM');
  });

  it('reports a number outside its bounds in the language in effect', () => {
    const node = { id: 'aws_db_instance.db', type: 'aws_db_instance', args: { allocated_storage: lit(5) } } as unknown as ResourceNode;
    const def = getDef('aws_db_instance')!;
    expect(fieldBoundsDiagnostics(node, def)[0].message).toBe('aws_db_instance.db: "allocated_storage" is 5 but must be between 20 and 65536');
    useLocale.getState().setLocale('pt-BR');
    expect(fieldBoundsDiagnostics(node, def)[0].message).toBe('aws_db_instance.db: "allocated_storage" é 5, mas precisa ser entre 20 e 65536');
  });
});
