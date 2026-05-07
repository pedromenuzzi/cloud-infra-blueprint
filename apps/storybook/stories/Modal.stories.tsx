import { Button, Modal } from '@blueprint/ui';
import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Components/Modal',
  component: Modal,
  // Modal requires `open`, `onClose` and `children`. Stories below override
  // the open state via local state, so the meta-level args are just stub
  // defaults to satisfy TypeScript on `StoryObj`.
  args: {
    open: false,
    onClose: () => {},
    children: null,
  },
  parameters: {
    docs: {
      description: {
        component:
          'Lightweight modal — closes on backdrop click and Escape, locks body scroll, exposes `aria-labelledby` / `aria-describedby` from the optional title and description.',
      },
    },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete project"
        description="This permanently removes the project and its versions. This action cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete project
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Type the project name <code className="font-mono">api-gateway</code> to confirm.
        </p>
      </Modal>
    </>
  );
}

export const Default: Story = {
  render: () => <Harness />,
};

export const InfoOnly: Story = {
  render: () => {
    function Inner() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Show info
          </Button>
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title="What changed in v0.2"
            className="max-w-lg"
          >
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Undo / Redo (Ctrl+Z / Ctrl+Shift+Z)</li>
              <li>Incremental HCL parser (-200x re-parse latency)</li>
              <li>Architecture Decision Records published in `docs/adr/`</li>
            </ul>
          </Modal>
        </>
      );
    }
    return <Inner />;
  },
};
