import { LogoLockup, LogoMark } from '@blueprint/ui';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Logo',
  component: LogoLockup,
  parameters: {
    docs: {
      description: {
        component:
          'The mark is a flat isometric cube using the canonical primary blue. Wordmark is text-based (Inter Variable) so it tracks the active theme automatically.',
      },
    },
  },
} satisfies Meta<typeof LogoLockup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lockup: Story = {
  render: () => (
    <div className="flex items-center gap-8">
      <LogoLockup size="sm" />
      <LogoLockup size="md" />
      <LogoLockup size="lg" />
    </div>
  ),
};

export const MarkOnly: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      <LogoMark size={20} />
      <LogoMark size={32} />
      <LogoMark size={48} />
      <LogoMark size={64} />
    </div>
  ),
};

export const VariantMark: Story = {
  render: () => <LogoLockup variant="mark" size="md" />,
};
