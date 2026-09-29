/**
 * Security delta: did an edit make things worse? Worse means the grade
 * dropped, or a critical / high finding appeared that wasn't there before.
 *
 * Findings are compared by what they say, not by id: rule ids are positional
 * (removing a safe rule shifts the risky one's index) and a rename changes
 * every address, and neither makes anything worse.
 */
import type { AuditResult, Finding } from './audit';

const GRADES = ['A', 'B', 'C', 'D', 'F'];

export interface SecurityDelta {
  before: AuditResult['grade'];
  after: AuditResult['grade'];
  gradeDropped: boolean;
  /** critical / high findings that weren't there before, worst first */
  added: Finding[];
  /** the finding the message is about */
  lead?: Finding;
  /** what to show: the workload the new risk reaches, else the resource it is about */
  target?: string;
  /** "Security grade B → D: SSH (22) is now open to the internet on aws_instance.web" */
  message: string;
}

/** kind + severity + wording + whether something is exposed through it */
export const findingSignature = (f: Finding) =>
  `${f.id.split(':')[0]}|${f.severity}|${f.title}|${f.related.length > 0 ? 'reachable' : ''}`;

/** "SSH (port 22) is open to the internet" → "SSH (22) is now open to the internet on aws_instance.web" */
export function describeFinding(f: Finding): string {
  if (f.id.startsWith('rule:')) {
    const text = f.title.replace(/\(port (\d+)\)/g, '($1)').replace(/ (is|are) open to the internet/, ' $1 now open to the internet');
    return f.related.length > 0 ? `${text} on ${f.related[0]}${f.related.length > 1 ? ` and ${f.related.length - 1} more` : ''}` : `${text} in ${f.resource}`;
  }
  return `${f.title} — ${f.resource}`;
}

export function securityDelta(before: AuditResult, after: AuditResult): SecurityDelta | null {
  const seen = new Map<string, number>();
  for (const f of before.findings) seen.set(findingSignature(f), (seen.get(findingSignature(f)) ?? 0) + 1);
  const fresh: Finding[] = [];
  for (const f of after.findings) {
    const sig = findingSignature(f);
    const n = seen.get(sig) ?? 0;
    if (n > 0) seen.set(sig, n - 1);
    else fresh.push(f);
  }
  const added = fresh.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const gradeDropped = !!before.grade && !!after.grade && GRADES.indexOf(after.grade) > GRADES.indexOf(before.grade);
  if (!gradeDropped && added.length === 0) return null;

  // findings come worst first
  const lead = added[0] ?? fresh[0];
  const head = gradeDropped
    ? `Security grade ${before.grade} → ${after.grade}`
    : `New ${lead!.severity} security risk`;
  return {
    before: before.grade,
    after: after.grade,
    gradeDropped,
    added,
    lead,
    target: lead ? (lead.related[0] ?? lead.resource) : undefined,
    message: lead ? `${head}: ${describeFinding(lead)}` : head,
  };
}
