import { findResourceDef } from '@blueprint/resources';
import { Badge, Input, ProviderIcon, cn, type ProviderId } from '@blueprint/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { useIRStore } from '@/store/useIRStore';

type InspectorTab = 'properties' | 'connections' | 'code';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'connections', label: 'Connections' },
  { id: 'code', label: 'Code' },
];

/**
 * Lateral inspector — image 01/06 reference. Three tabs:
 *
 * - **Properties**: form auto-generated from the resource Zod schema (F2).
 * - **Connections**: lists incoming/outgoing edges, allows linking ports.
 * - **Code**: shows just the HCL fragment for the selected resource.
 *
 * For now F1 ships a static-looking form so the design system is fully
 * exercised; F2 will hook it up to react-hook-form + Zod resolvers.
 */
export function Inspector() {
  const selectedId = useIRStore((s) => s.selectedNodeId);
  const node = useIRStore((s) => s.ir.resources.find((r) => r.id === selectedId));
  const def = node ? findResourceDef(node.type) : undefined;
  const [tab, setTab] = useState<InspectorTab>('properties');

  return (
    <aside className="flex w-80 flex-col border-l border-border/60 bg-card" aria-label="Inspector">
      <header className="border-b border-border/60 p-3">
        {def ? (
          <div className="flex items-center gap-2">
            <ProviderBadge provider={inferProvider(def.type)} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{def.displayName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {node?.name ?? 'unnamed'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold">Inspector</p>
            <p className="text-xs text-muted-foreground">Select a node on the canvas to edit.</p>
          </div>
        )}
      </header>

      <nav className="flex border-b border-border/60 px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'relative px-3 py-2.5 text-xs font-medium transition-colors',
              tab === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4">
        {!node && (
          <div className="rounded-md border border-dashed border-border bg-surface-1 p-4 text-center text-xs text-muted-foreground">
            Click any node on the canvas to inspect.
          </div>
        )}

        {node && def && tab === 'properties' && <PropertiesForm name={node.name} type={def.type} />}
        {node && def && tab === 'connections' && <ConnectionsTab />}
        {node && def && tab === 'code' && <CodeTab type={def.type} name={node.name} />}
      </div>
    </aside>
  );
}

function PropertiesForm({ name, type }: { name: string; type: string }) {
  return (
    <form className="space-y-4 text-xs">
      <Field label="Name">
        <Input defaultValue={name} placeholder="Name" />
      </Field>

      {type === 'aws_instance' && (
        <>
          <Field label="AMI">
            <Input placeholder="Autocomplete..." />
          </Field>
          <Field label="Instance type">
            <Select
              options={['t3.micro', 't3.small', 't3.medium', 'm5.large', 'c5.large']}
              value="t3.medium"
            />
          </Field>
          <Field label="Subnet">
            <Select
              options={['module.subnet-public', 'module.subnet-private']}
              placeholder="Subnet"
            />
          </Field>
        </>
      )}

      {type === 'aws_db_instance' && (
        <>
          <Field label="Engine">
            <Select options={['postgres', 'mysql', 'mariadb']} value="postgres" />
          </Field>
          <Field label="Instance class">
            <Select options={['db.t3.medium', 'db.t3.large', 'db.m5.large']} value="db.t3.medium" />
          </Field>
        </>
      )}

      <Field label="Tags">
        <div className="flex items-center gap-2">
          <Input placeholder="key" className="flex-1" />
          <Input placeholder="value" className="flex-1" />
          <button
            type="button"
            aria-label="Add tag"
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:border-primary/40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <Input placeholder="Tag" className="mt-2" />
      </Field>
    </form>
  );
}

function ConnectionsTab() {
  return (
    <div className="space-y-3 text-xs">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Inbound
      </p>
      <div className="space-y-1.5">
        <ConnectionRow from="aws_subnet.public" port="subnet" />
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Outbound
      </p>
      <div className="space-y-1.5">
        <ConnectionRow from="aws_security_group.web" port="sg" />
      </div>
    </div>
  );
}

function ConnectionRow({ from, port }: { from: string; port: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
      <span className="font-mono text-[11px]">{from}</span>
      <Badge variant="secondary" size="sm">
        {port}
      </Badge>
    </div>
  );
}

function CodeTab({ type, name }: { type: string; name: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-surface-1 p-3 text-[11px] leading-relaxed">
      <code className="font-mono">
        <span className="text-primary">resource</span>{' '}
        <span className="text-success">{`"${type}"`}</span>{' '}
        <span className="text-success">{`"${name}"`}</span> {'{'}
        {'\n  '}# auto-generated from canvas
        {'\n}'}
      </code>
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({
  options,
  value,
  placeholder,
}: {
  options: string[];
  value?: string;
  placeholder?: string;
}) {
  return (
    <select
      defaultValue={value}
      className="focus-ring flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs"
    >
      {placeholder && !value && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function ProviderBadge({ provider }: { provider: ProviderId }) {
  const bg =
    provider === 'aws'
      ? 'bg-provider-aws/15'
      : provider === 'azure'
        ? 'bg-provider-azure/15'
        : provider === 'gcp'
          ? 'bg-provider-gcp/15'
          : 'bg-provider-multi/15';
  return (
    <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', bg)}>
      <ProviderIcon provider={provider} size={16} />
    </span>
  );
}

function inferProvider(type: string): ProviderId {
  if (type.startsWith('aws_')) return 'aws';
  if (type.startsWith('azurerm_') || type.startsWith('azure')) return 'azure';
  if (type.startsWith('google_') || type.startsWith('gcp_')) return 'gcp';
  return 'aws';
}
