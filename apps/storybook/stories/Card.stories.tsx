import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@blueprint/ui';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Card',
  component: Card,
  parameters: {
    docs: {
      description: {
        component:
          'Cards are the canonical surface for grouping content. Use the sub-components (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) for predictable spacing.',
      },
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  render: () => (
    <Card padded className="max-w-sm">
      Plain card with `padded`. Useful for ad-hoc surfaces.
    </Card>
  ),
};

export const StructuredFlat: Story = {
  render: () => (
    <Card variant="flat" className="max-w-sm">
      <CardHeader>
        <CardTitle>Flat card</CardTitle>
        <CardDescription>
          Used when the surrounding container already provides elevation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Body content sits at full width with the standard `p-5 pt-0` rhythm.
        </p>
      </CardContent>
    </Card>
  ),
};

export const StructuredRaised: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Project: api-gateway</CardTitle>
        <CardDescription>Last opened 2 hours ago by you.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Badge variant="aws">AWS</Badge>
        <Badge variant="success">Healthy</Badge>
        <Badge variant="outline">12 resources</Badge>
      </CardContent>
      <CardFooter>
        <Button variant="link">View details</Button>
        <Button>Open in editor</Button>
      </CardFooter>
    </Card>
  ),
};

export const HoverInteractive: Story = {
  render: () => (
    <Card variant="hover" padded className="max-w-sm cursor-pointer">
      <h3 className="font-semibold">Click me</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The `hover` variant gains a soft shadow lift and a primary-tinted border on hover.
      </p>
    </Card>
  ),
};
