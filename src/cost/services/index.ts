import { messagesFor } from '@/i18n/messages';
import { costMessages } from '../messages';
import { AWS_FREE_PREFIXES, AWS_RULES } from './aws';
import { AZURE_FREE_PREFIXES, AZURE_RULES } from './azure';
import { free, unknown, type Rule } from './common';
import { GCP_FREE_PREFIXES, GCP_RULES } from './gcp';

const RULES: Record<string, Rule> = { ...AWS_RULES, ...AZURE_RULES, ...GCP_RULES };

/** providers that only run inside Terraform (random_password, tls_private_key…) */
const LOCAL = /^(random|null|tls|time|local|terraform)_/;
const FREE_PREFIXES = [...AWS_FREE_PREFIXES, ...AZURE_FREE_PREFIXES, ...GCP_FREE_PREFIXES];

export function ruleFor(type: string): Rule {
  const rule = RULES[type];
  if (rule) return rule;
  if (LOCAL.test(type)) return (ctx) => free(messagesFor(costMessages, ctx.locale).insideTerraform);
  if (FREE_PREFIXES.some((p) => p.test(type))) return () => free();
  return (ctx) => unknown(messagesFor(costMessages, ctx.locale).typeNotInTable);

}

/** whether the type is priced (or known to be free) on purpose, rather than falling through to "unknown" */
export function hasRule(type: string): boolean {
  return type in RULES || LOCAL.test(type) || FREE_PREFIXES.some((p) => p.test(type));
}

/**
 * Catalog options the price table deliberately doesn't give a fixed price,
 * and what the estimate says instead (price-data integrity is checked
 * against this list in prices.test.ts).
 */
export const UNPRICED_OPTIONS: Record<string, { kind: 'usage' | 'unknown'; why: string }> = {
  'azurerm_service_plan.sku_name=Y1': { kind: 'usage', why: 'Functions consumption plan, billed per execution' },
  'google_sql_database_instance.database_version=SQLSERVER_2019_STANDARD': { kind: 'unknown', why: 'SQL Server license' },
  'azurerm_public_ip.sku=Basic': { kind: 'unknown', why: 'retired SKU' },
  'azurerm_servicebus_namespace.sku=Basic': { kind: 'usage', why: 'billed per operation' },
  'aws_dynamodb_table.billing_mode=PROVISIONED': { kind: 'unknown', why: 'provisioned capacity units are not in the table' },
};
