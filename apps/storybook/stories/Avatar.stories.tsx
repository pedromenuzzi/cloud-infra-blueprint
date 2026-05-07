import { Avatar, AvatarGroup } from '@blueprint/ui';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  args: { name: 'Pedro Silva', size: 32 },
  parameters: {
    docs: {
      description: {
        component:
          'Initials are derived from the name; background color is hashed deterministically. `<AvatarGroup>` stacks avatars with overlap and a `+N` overflow chip.',
      },
    },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InitialsOnly: Story = {};

export const WithImage: Story = {
  args: { src: 'https://i.pravatar.cc/64?img=12' },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {[20, 28, 36, 48, 64].map((size) => (
        <Avatar key={size} name="Anna Lima" size={size} />
      ))}
    </div>
  ),
};

export const Rings: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar name="No ring" />
      <Avatar name="Online" ring="success" />
      <Avatar name="Focused" ring="primary" />
      <Avatar name="At risk" ring="warning" />
    </div>
  ),
};

export const Group: Story = {
  render: () => (
    <AvatarGroup max={3}>
      <Avatar name="Anna Lima" />
      <Avatar name="Bob Costa" />
      <Avatar name="Carol Dias" />
      <Avatar name="Dan Eboli" />
      <Avatar name="Eve Faria" />
    </AvatarGroup>
  ),
};
