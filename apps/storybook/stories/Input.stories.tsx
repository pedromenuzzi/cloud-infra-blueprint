import { Input } from '@blueprint/ui';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Input',
  component: Input,
  args: { placeholder: 'name@company.com' },
  parameters: {
    docs: {
      description: {
        component:
          '36 px tall (`h-9`), 8 px corner radius, focus ring uses the primary color. Always pair with an explicit label or `aria-label`.',
      },
    },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <label className="flex max-w-sm flex-col gap-1">
      <span className="text-sm font-medium">Email</span>
      <Input {...args} />
    </label>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Default</span>
        <Input placeholder="Type here" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">With value</span>
        <Input defaultValue="aws_instance.web" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Disabled</span>
        <Input disabled defaultValue="locked" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Required</span>
        <Input required placeholder="Required field" aria-invalid="true" />
      </label>
    </div>
  ),
};

export const Types: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-3">
      <Input type="email" placeholder="email" />
      <Input type="password" placeholder="password" />
      <Input type="number" placeholder="123" />
      <Input type="search" placeholder="search…" />
    </div>
  ),
};
