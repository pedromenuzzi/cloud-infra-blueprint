import { Badge } from '@blueprint/ui';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  args: { children: 'New', variant: 'default' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'outline',
        'success',
        'warning',
        'danger',
        'aws',
        'azure',
        'gcp',
        'multi',
      ],
    },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const StatusVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Healthy</Badge>
      <Badge variant="warning">At risk</Badge>
      <Badge variant="danger">Failed</Badge>
    </div>
  ),
};

export const ProviderVariants: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Provider chips reuse the canonical brand hues from `--provider-aws` / `--provider-azure` / `--provider-gcp` / `--provider-multi`.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="aws">AWS</Badge>
      <Badge variant="azure">Azure</Badge>
      <Badge variant="gcp">GCP</Badge>
      <Badge variant="multi">Multi-cloud</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge size="sm">Small</Badge>
      <Badge size="md">Medium</Badge>
    </div>
  ),
};
