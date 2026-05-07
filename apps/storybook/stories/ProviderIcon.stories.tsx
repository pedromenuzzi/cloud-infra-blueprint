import { PROVIDERS, ProviderIcon, type ProviderId } from '@blueprint/ui';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/ProviderIcon',
  component: ProviderIcon,
  args: { provider: 'aws', size: 24 },
  argTypes: {
    provider: { control: 'inline-radio', options: ['aws', 'azure', 'gcp', 'multi'] },
    size: { control: { type: 'number', min: 12, max: 96, step: 2 } },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Stylized monogram per provider. We do **not** ship the official AWS / Azure / GCP brand assets — those have license restrictions. Use these inside the canvas, palette, badges, etc.',
      },
    },
  },
} satisfies Meta<typeof ProviderIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllProviders: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
        <div key={id} className="flex flex-col items-center gap-2">
          <ProviderIcon provider={id} size={48} />
          <span className="text-xs text-muted-foreground">{PROVIDERS[id].label}</span>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      {[14, 18, 24, 32, 48, 64].map((size) => (
        <ProviderIcon key={size} provider="aws" size={size} />
      ))}
    </div>
  ),
};

export const Recoloring: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The SVG paths use `currentColor` — pass a Tailwind text color via `className` to override the default brand hue when needed (e.g. monochrome variants in the inspector).',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-4">
      <ProviderIcon provider="azure" size={32} />
      <ProviderIcon provider="azure" size={32} className="text-foreground" />
      <ProviderIcon provider="azure" size={32} className="text-muted-foreground" />
    </div>
  ),
};
