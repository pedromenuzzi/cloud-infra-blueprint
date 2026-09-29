/**
 * "Why is this reachable?" — per port, the chain of controls that lets the
 * internet in, and what stops the traffic a rule means to admit. Every step is
 * a way back to the source: a resource selects it on the canvas, a rule opens
 * the rules editor at its row.
 */
import {
  Ban,
  ChevronRight,
  Globe,
  ListOrdered,
  MapPin,
  Network,
  Route,
  Router,
  Server,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { canvasApi } from '@/features/editor/canvasApi';
import { useEditor } from '@/features/editor/store';
import { cn } from '@/lib/utils';
import { familiesLabel, type AccessExplanation, type BlockedPort, type PathStep, type PortAccess, type StepKind } from '@/security/access';
import { trafficRisk } from '@/security/audit';
import { serviceName } from '@/security/model';
import { SEVERITY_COLORS, useSecurityUi } from './securityStore';

const STEP_ICONS: Record<StepKind, LucideIcon> = {
  internet: Globe,
  gateway: Router,
  route: Route,
  subnet: Network,
  nacl: ListOrdered,
  sg: Shield,
  nsg: Shield,
  firewall: Shield,
  address: MapPin,
  resource: Server,
};

const WORDS: Record<string, string> = {
  all: 'All traffic',
  'all TCP': 'All TCP ports',
  'all UDP': 'All UDP ports',
  icmp: 'ICMP',
  'other protocols': 'Other protocols',
  'other ports': 'Other ports',
};

/** ":443" for ports, words for the rest; an expression stays as written */
const portText = (ports: string) => WORDS[ports] ?? (/^\d/.test(ports) ? `:${ports.replace(/\/udp$/, '')}` : ports);

/** "HTTPS", "DNS · UDP", "UDP" — what runs on a port label */
function serviceOf(ports: string): string | undefined {
  const udp = ports.endsWith('/udp');
  const m = /^(\d+)(?:\/udp)?$/.exec(ports);
  if (!m) return udp ? 'UDP' : undefined;
  const port = Number(m[1]);
  const name = serviceName({ protocol: udp ? 'udp' : 'tcp', fromPort: port, toPort: port });
  const known = !/^(TCP|UDP) /.test(name);
  if (udp) return known ? `${name} · UDP` : 'UDP';
  return known ? name : undefined;
}

/** "Port 22", "Ports 8000-8080", "All TCP ports", "Ports var.port" */
function portTitle(ports: string): string {
  if (WORDS[ports]) return WORDS[ports];
  const text = ports.replace(/\/udp/g, '');
  return /^\d+$/.test(text) ? `Port ${text}` : `Ports ${text}`;
}

/** Select a resource, or open a rule in the rules editor (at its row). */
export function activateStep(step: PathStep) {
  if (step.rule) {
    useSecurityUi.getState().openRules(step.rule.owner, step.rule.id);
    return;
  }
  const id = step.resource;
  if (!id || !useEditor.getState().ir.resources.some((r) => r.id === id)) return;
  useEditor.getState().setSelection(id, 'canvas');
  requestAnimationFrame(() => canvasApi()?.focusNode(id));
}

function StepRow({ step }: { step: PathStep }) {
  const Icon = step.verdict === 'deny' ? Ban : STEP_ICONS[step.kind];
  const deny = step.verdict === 'deny';
  const action = step.rule ? (step.rule.id ? 'open this rule in the rules editor' : 'open these rules in the rules editor') : step.resource ? 'show it on the canvas' : undefined;
  const body = (
    <>
      <span className={cn('block break-words text-[11.5px] font-semibold leading-snug', deny ? 'text-danger' : 'text-foreground')}>
        {step.title}
      </span>
      {step.detail ? <span className="block break-words text-[10.5px] leading-snug text-muted">{step.detail}</span> : null}
      {action ? <span className="sr-only">, {action}</span> : null}
    </>
  );
  return (
    <li className={cn('relative', step.unreached && 'opacity-60')} data-step={step.kind}>
      <span
        aria-hidden="true"
        className={cn(
          'absolute -left-[20px] top-[5px] flex h-[15px] w-[15px] items-center justify-center rounded-full border bg-surface-1',
          deny ? 'border-danger/50 text-danger' : 'text-muted',
        )}
      >
        <Icon className="h-[9px] w-[9px]" />
      </span>
      {action ? (
        <button
          type="button"
          onClick={() => activateStep(step)}
          title={step.rule ? 'Open in the rules editor' : 'Show on the canvas'}
          className="group block w-full rounded-[6px] px-1.5 py-1 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {body}
        </button>
      ) : (
        <div className="px-1.5 py-1">{body}</div>
      )}
    </li>
  );
}

function Chain({ steps, label }: { steps: PathStep[]; label: string }) {
  return (
    <ol aria-label={label} className="relative ml-[9px] space-y-px border-l border-dashed border-border-strong pl-[11px]">
      {steps.map((s, i) => (
        <StepRow key={i} step={s} />
      ))}
    </ol>
  );
}

function Disclosure({
  header,
  children,
  defaultOpen,
  testId,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const id = useId();
  return (
    <li className="rounded-[8px] border bg-surface-1" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        {header}
      </button>
      {open ? (
        <div id={id} className="bp-pop-in space-y-2 px-2 pb-2 pt-0.5">
          {children}
        </div>
      ) : null}
    </li>
  );
}

function PortHeader({ ports, families, note, risk }: { ports: string; families: string; note?: string; risk?: string }) {
  const service = serviceOf(ports);
  const text = portText(ports);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {risk ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: risk }} /> : null}
      <span className={cn('shrink-0 text-[11.5px] font-semibold text-foreground', text.startsWith(':') || !WORDS[ports] ? 'font-mono' : '')}>
        {text}
      </span>
      {service ? <span className="truncate text-[11px] text-muted">{service}</span> : null}
      <span className="flex-1" />
      {note ? <span className="shrink-0 text-[10.5px] text-faint">{note}</span> : null}
      {families !== 'IPv4' ? <span className="shrink-0 text-[10px] font-medium text-faint">{families}</span> : null}
    </span>
  );
}

function OpenPort({ port, defaultOpen }: { port: PortAccess; defaultOpen?: boolean }) {
  const risk = port.traffic ? trafficRisk(port.traffic) : null;
  const families = familiesLabel([...new Set(port.paths.flatMap((p) => p.families))]);
  return (
    <Disclosure
      testId={`access-port-${port.ports}`}
      defaultOpen={defaultOpen}
      header={
        <PortHeader
          ports={port.ports}
          families={families}
          risk={risk ? SEVERITY_COLORS[risk.severity] : undefined}
          note={!port.traffic ? "can't verify" : port.paths.length > 1 ? `${port.paths.length} ways in` : undefined}
        />
      }
    >
      {risk ? <p className="text-[11px] font-medium" style={{ color: SEVERITY_COLORS[risk.severity] }}>{risk.title}</p> : null}
      {port.paths.map((p, i) => (
        <div key={i}>
          {port.paths.length > 1 ? <p className="mb-1 text-[10.5px] font-semibold text-faint">Way {i + 1} · {familiesLabel(p.families)}</p> : null}
          <Chain steps={p.steps} label={`Path for ${portText(port.ports)}${port.paths.length > 1 ? `, way ${i + 1}` : ''}`} />
        </div>
      ))}
    </Disclosure>
  );
}

function BlockedEntry({ entry }: { entry: BlockedPort }) {
  const service = serviceOf(entry.ports);
  const title = portTitle(entry.ports);
  return (
    <Disclosure
      testId={`blocked-port-${entry.ports}`}
      header={
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Ban aria-hidden="true" className="h-3 w-3 shrink-0 text-danger" />
            <span className="truncate text-[11.5px] font-semibold text-foreground">
              {title} from the internet{service ? <span className="font-normal text-muted"> · {service}</span> : null}
            </span>
            {entry.families.length === 1 && entry.families[0] === 'ipv6' ? <span className="ml-auto shrink-0 text-[10px] text-faint">IPv6</span> : null}
          </span>
          <span className="mt-px block text-[11px] leading-snug text-muted">{entry.reason}</span>
        </span>
      }
    >
      <Chain steps={entry.steps} label={`Why ${title.toLowerCase()} is blocked`} />
    </Disclosure>
  );
}

/**
 * The open ports (each expands into its path), then the blocked ones.
 * `bare`: just the open ports, no headings (the security panel lists them under the resource).
 */
export function AccessPaths({ access, openFirst, bare }: { access: AccessExplanation; openFirst?: boolean; bare?: boolean }) {
  if (bare) {
    return (
      <ul className="space-y-1" aria-label="Ways in from the internet">
        {access.open.map((p, i) => (
          <OpenPort key={p.ports} port={p} defaultOpen={openFirst && i === 0} />
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-2.5">
      {access.open.length ? (
        <section aria-label="Why is this reachable?">
          <h4 className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">Why is this reachable?</h4>
          <ul className="space-y-1">
            {access.open.map((p, i) => (
              <OpenPort key={p.ports} port={p} defaultOpen={openFirst && i === 0} />
            ))}
          </ul>
        </section>
      ) : null}
      {access.blocked.length ? (
        <section aria-label="Blocked from the internet">
          <h4 className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">Blocked from the internet</h4>
          <ul className="space-y-1">
            {access.blocked.map((b, i) => (
              <BlockedEntry key={`${b.ports}:${b.reason}:${i}`} entry={b} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
