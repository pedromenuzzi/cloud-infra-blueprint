import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  Input,
  LogoLockup,
  LogoMark,
  Modal,
  PROVIDERS,
  ProviderIcon,
} from '@blueprint/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Smoke + behavior tests for every primitive in `@blueprint/ui` consumed by
 * the web app. Keeps the contract honest: a regression in a low-level
 * component will fail here before it shows up in a route or e2e test.
 */

describe('@blueprint/ui — Button', () => {
  it('renders children and forwards onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects disabled and skips onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the variant class for danger', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-danger');
  });
});

describe('@blueprint/ui — Card', () => {
  it('renders content', () => {
    render(<Card>hello</Card>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});

describe('@blueprint/ui — Input', () => {
  it('reflects user typing via controlled value', async () => {
    function Sample() {
      const [v, setV] = useState('');
      return <Input aria-label="email" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    render(<Sample />);
    const input = screen.getByLabelText('email') as HTMLInputElement;
    await userEvent.type(input, 'pedro@local');
    expect(input.value).toBe('pedro@local');
  });
});

describe('@blueprint/ui — Badge', () => {
  it('renders variant text', () => {
    render(<Badge variant="aws">AWS</Badge>);
    expect(screen.getByText('AWS')).toBeInTheDocument();
  });
});

describe('@blueprint/ui — Avatar', () => {
  it('shows initials for two-word names', () => {
    render(<Avatar name="Pedro Silva" />);
    expect(screen.getByText('PS')).toBeInTheDocument();
  });

  it('falls back to ? when name is empty', () => {
    render(<Avatar name="" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders an <img> when src is provided', () => {
    const { container } = render(<Avatar name="Pedro" src="/p.png" />);
    // The wrapping span exposes role="img" for screen readers; the actual
    // <img> tag carries the URL. Either is acceptable, but we make sure both
    // exist with the same accessible name.
    expect(screen.getAllByRole('img', { name: 'Pedro' }).length).toBeGreaterThan(0);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/p.png');
  });

  it('AvatarGroup truncates with +N overflow indicator', () => {
    render(
      <AvatarGroup max={2}>
        <Avatar name="Anna" />
        <Avatar name="Bob" />
        <Avatar name="Carol" />
        <Avatar name="Dan" />
      </AvatarGroup>,
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
    // First 2 are visible.
    expect(screen.getByLabelText('Anna')).toBeInTheDocument();
    expect(screen.getByLabelText('Bob')).toBeInTheDocument();
  });
});

describe('@blueprint/ui — Logo', () => {
  it('LogoMark renders an SVG (decorative when paired with the wordmark)', () => {
    const { container } = render(<LogoMark />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
  });

  it('LogoLockup renders the wordmark text alongside the mark', () => {
    render(<LogoLockup />);
    expect(screen.getByText(/Cloud Blueprint/i)).toBeInTheDocument();
  });

  it('LogoLockup variant=mark hides the wordmark', () => {
    render(<LogoLockup variant="mark" />);
    expect(screen.queryByText(/Cloud Blueprint/i)).not.toBeInTheDocument();
  });
});

describe('@blueprint/ui — Provider', () => {
  it('exposes metadata for every supported provider', () => {
    expect(PROVIDERS.aws.label).toBe('AWS');
    expect(PROVIDERS.azure.label).toBe('Azure');
    expect(PROVIDERS.gcp.label).toBe('GCP');
    expect(PROVIDERS.multi.label).toMatch(/Multi/);
  });

  it('ProviderIcon renders a labeled monogram chip with the brand color', () => {
    const { container } = render(<ProviderIcon provider="aws" size={24} />);
    const chip = container.querySelector('[role="img"]') as HTMLElement | null;
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute('aria-label')).toBe('AWS');
    expect(chip!.textContent).toBe('aws');
    expect(chip!.style.backgroundColor).toBeTruthy();
  });
});

describe('@blueprint/ui — Modal', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <Modal open={open} onClose={() => setOpen(false)} title="Hi" description="World">
        <p>Body content</p>
      </Modal>
    );
  }

  it('renders title and description with proper aria attributes', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(screen.getByText('Hi')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('locks body scroll while open', () => {
    render(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('returns null when open is false', () => {
    function Closed() {
      return (
        <Modal open={false} onClose={() => {}} title="x">
          x
        </Modal>
      );
    }
    const { container } = render(<Closed />);
    expect(container.firstChild).toBeNull();
  });
});
