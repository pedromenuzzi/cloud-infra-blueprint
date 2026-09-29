/** The words of the security delta (delta.ts): the toast after an edit that makes the design less safe. */
import { defineMessages } from '@/i18n/messages';

type Urgent = 'critical' | 'high' | 'medium' | 'low';

const RISK_PT: Record<Urgent, string> = { critical: 'crítico', high: 'alto', medium: 'médio', low: 'baixo' };

export const deltaMessages = defineMessages(
  {
    gradeDropped: (before: string | null, after: string | null) => `Security grade ${before} → ${after}`,
    newRisk: (severity: Urgent) => `New ${severity} security risk`,
    /** "SSH (22) is now open to the internet on aws_instance.web and 2 more" */
    onTargets: (alert: string, first: string, more: number) => `${alert} on ${first}${more > 0 ? ` and ${more} more` : ''}`,
    inOwner: (alert: string, owner: string) => `${alert} in ${owner}`,
    message: (head: string, what: string | undefined) => (what ? `${head}: ${what}` : head),
  },
  {
    gradeDropped: (before: string | null, after: string | null) => `Nota de segurança ${before} → ${after}`,
    newRisk: (severity: Urgent) => `Novo risco de segurança ${RISK_PT[severity]}`,
    onTargets: (alert: string, first: string, more: number) => `${alert} em ${first}${more > 0 ? ` e mais ${more}` : ''}`,
    inOwner: (alert: string, owner: string) => `${alert} em ${owner}`,
    message: (head: string, what: string | undefined) => (what ? `${head}: ${what}` : head),
  },
);
