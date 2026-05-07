import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Foundations/Tokens',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Visual reference for the design tokens declared in `packages/ui/src/styles.css`. Edit the CSS variables there — never hard-code values in components.',
      },
    },
  },
};

export default meta;

type Story = StoryObj;

const colors = [
  { name: 'background', cssVar: '--background' },
  { name: 'surface-1', cssVar: '--surface-1' },
  { name: 'surface-2', cssVar: '--surface-2' },
  { name: 'foreground', cssVar: '--foreground' },
  { name: 'primary', cssVar: '--primary' },
  { name: 'primary-hover', cssVar: '--primary-hover' },
  { name: 'secondary', cssVar: '--secondary' },
  { name: 'muted-foreground', cssVar: '--muted-foreground' },
  { name: 'border', cssVar: '--border' },
  { name: 'success', cssVar: '--success' },
  { name: 'warning', cssVar: '--warning' },
  { name: 'danger', cssVar: '--danger' },
  { name: 'provider-aws', cssVar: '--provider-aws' },
  { name: 'provider-azure', cssVar: '--provider-azure' },
  { name: 'provider-gcp', cssVar: '--provider-gcp' },
  { name: 'provider-multi', cssVar: '--provider-multi' },
];

export const Colors: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-4">
      {colors.map((c) => (
        <div
          key={c.name}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div
            aria-hidden
            className="h-12 w-12 rounded-md border border-border"
            style={{ background: `hsl(var(${c.cssVar}))` }}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{c.name}</div>
            <code className="block truncate font-mono text-[11px] text-muted-foreground">
              hsl(var({c.cssVar}))
            </code>
          </div>
        </div>
      ))}
    </div>
  ),
};

const typeScale = [
  { name: 'display', class: 'text-display' },
  { name: 'h1', class: 'text-h1' },
  { name: 'h2', class: 'text-h2' },
  { name: 'body', class: 'text-body' },
  { name: 'small', class: 'text-small text-muted-foreground' },
];

export const Typography: Story = {
  render: () => (
    <div className="space-y-5 p-6">
      {typeScale.map((t) => (
        <div key={t.name}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t.name}
          </div>
          <div className={t.class}>The quick brown fox jumps over the lazy dog</div>
        </div>
      ))}
    </div>
  ),
};

export const RadiiAndShadows: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-3">
      {[
        { label: 'rounded-sm + shadow-xs', cls: 'rounded-sm shadow-xs' },
        { label: 'rounded-md + shadow-sm', cls: 'rounded-md shadow-sm' },
        { label: 'rounded-lg + shadow-md', cls: 'rounded-lg shadow-md' },
        { label: 'rounded-xl + shadow-lg', cls: 'rounded-xl shadow-lg' },
        { label: 'rounded-xl + shadow-glow', cls: 'rounded-xl shadow-glow' },
      ].map((s) => (
        <div
          key={s.label}
          className={`flex h-24 items-center justify-center border border-border bg-card text-sm text-muted-foreground ${s.cls}`}
        >
          {s.label}
        </div>
      ))}
    </div>
  ),
};
