/**
 * The words of the cost estimate (estimate.ts, resolve.ts, services/common.ts
 * and services/index.ts): region notes, what the totals leave out, why a
 * resource can't be priced. Prices stay in US dollars in both languages;
 * format.ts writes them the way each language writes money.
 */
import { formatNumber } from '@/i18n/format';
import { defineMessages } from '@/i18n/messages';

/** a number as Portuguese writes it: 0,25 · 1.024 */
export const numPt = (n: number) => formatNumber(n, { maximumFractionDigits: 4 }, 'pt-BR');

export const costMessages = defineMessages(
  {
    providers: { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', other: 'Other' },
    noRegion: (region: string) => `No region in the code — priced at ${region}`,
    regional: (region: string, base: string, multiplier: number) =>
      `${region}: ${base} prices × ${multiplier.toFixed(2)} (regional multiplier)`,
    otherRegion: (base: string, region: string) => `Prices for ${base} — ${region} may differ`,
    oneCosts: (reason: string, one: string) => `${reason}. One costs about ${one} a month.`,
    notCreated: 'count = 0: not created',
    onDemand: (hours: number) => `On-demand list prices, ${hours} hours a month.`,
    notIncluded: 'Not included: tax, data transfer, support plans and usage-based charges (requests, stored data, LCUs…).',
    noDiscounts: 'No free tier, credits, reserved or savings-plan discounts are subtracted.',
    pricesAsOf: (provider: string, region: string, date: string) =>
      `${provider}: ${region} prices as of ${date}; other regions scaled by a regional multiplier.`,
    forEach: 'for_each: how many instances depends on the collection',
    countExpr: 'count is an expression: how many instances is decided at plan time',
    countOptional: 'count is conditional: 0 or 1 instance, decided at plan time',
    notLiteral: (field: string) => `${field} isn't set to a literal value`,
    notInTable: (field: string, value: string) => `${field} "${value}" isn't in the price table`,
    insideTerraform: 'Runs inside Terraform — nothing is billed',
    typeNotInTable: "This resource type isn't in the price table yet",
  },
  {
    providers: { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', other: 'Outros' },
    noRegion: (region: string) => `Nenhuma região no código — preços de ${region}`,
    regional: (region: string, base: string, multiplier: number) =>
      `${region}: preços de ${base} × ${formatNumber(multiplier, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, 'pt-BR')} (multiplicador regional)`,
    otherRegion: (base: string, region: string) => `Preços de ${base} — em ${region} podem ser diferentes`,
    oneCosts: (reason: string, one: string) => `${reason}. Uma unidade custa cerca de ${one} por mês.`,
    notCreated: 'count = 0: não é criado',
    onDemand: (hours: number) => `Preços de tabela sob demanda, ${hours} horas por mês.`,
    notIncluded:
      'Não incluídos: impostos, transferência de dados, planos de suporte e cobranças por uso (requisições, dados armazenados, LCUs…).',
    noDiscounts: 'Nenhum nível gratuito, crédito ou desconto de instâncias reservadas ou savings plans é abatido.',
    pricesAsOf: (provider: string, region: string, date: string) =>
      `${provider}: preços de ${region} em ${date}; outras regiões ajustadas por um multiplicador regional.`,
    forEach: 'for_each: o número de instâncias depende da coleção',
    countExpr: 'count é uma expressão: o número de instâncias só é decidido no plan',
    countOptional: 'count é condicional: 0 ou 1 instância, decidido no plan',
    notLiteral: (field: string) => `${field} não está definido com um valor literal`,
    notInTable: (field: string, value: string) => `${field} "${value}" não está na tabela de preços`,
    insideTerraform: 'Roda dentro do Terraform — nada é cobrado',
    typeNotInTable: 'Este tipo de recurso ainda não está na tabela de preços',
  },
);

export type CostMessages = (typeof costMessages)['en'];
