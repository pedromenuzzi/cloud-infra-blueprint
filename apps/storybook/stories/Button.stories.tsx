import { Button } from '@blueprint/ui';
import { ArrowRight, Check, Plus, Trash2 } from 'lucide-react';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: {
    children: 'Save changes',
    variant: 'primary',
    size: 'md',
    disabled: false,
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'outline', 'danger', 'link'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Buttons follow the design system in image 06: solid primary blue, neutral secondary, transparent ghost and a danger red. Six variants × four sizes.',
      },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium (default)</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Check className="h-4 w-4" /> Save changes
      </Button>
      <Button variant="secondary">
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
      <Button variant="danger">
        <Trash2 className="h-4 w-4" /> Delete project
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, children: 'Disabled' },
};

export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'There is no built-in loading variant: render the spinner inline so callers stay in control of accessible status text. Use `aria-live` on the surrounding region when toggling between states.',
      },
    },
  },
  render: () => (
    <Button disabled aria-busy="true">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
      />
      Saving…
    </Button>
  ),
};
