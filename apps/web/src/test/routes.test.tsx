import { applyOps, emptyIR, newResource } from '@blueprint/ir';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from './render';

import { encodeIR } from '@/features/share';
import { TemplatesGallery } from '@/features/templates/TemplatesGallery';
import { LandingRoute } from '@/routes/landing';
import { NotFoundRoute } from '@/routes/not-found';
import { PlaygroundRoute } from '@/routes/playground';

/**
 * Route-level component tests. We don't boot the full router (`RouterProvider`
 * + lazy chunks would slow Vitest considerably); instead each route renders
 * inside a `<MemoryRouter>` via the helper. That keeps tests fast and lets us
 * assert behavior, not chunk loading.
 */

beforeEach(() => {
  // Make every API call deterministic: timeout immediately so hooks fall back
  // to bundled data without waiting for the network.
  globalThis.fetch = vi
    .fn()
    .mockImplementation(() => Promise.reject(new Error('test: no network'))) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Landing route', () => {
  it('renders the hero headline + primary CTA + product mockup', () => {
    renderWithRouter(<LandingRoute />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Two CTAs go to the dashboard ("Start free" / "Open dashboard"-style).
    const links = screen.getAllByRole('link', { name: /dashboard|start|free|design/i });
    expect(links.length).toBeGreaterThan(0);
  });

  it('exposes the brand wordmark in the header', () => {
    renderWithRouter(<LandingRoute />);
    expect(screen.getAllByText(/Cloud Blueprint/i).length).toBeGreaterThan(0);
  });
});

describe('404 route', () => {
  it('renders a friendly title and back-home links', () => {
    renderWithRouter(<NotFoundRoute />);
    expect(screen.getByText(/404/)).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((l) => l.getAttribute('href') === '/')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/dashboard')).toBe(true);
  });
});

describe('Playground route (/p/:hash)', () => {
  it('renders the read-only header and ready card for a valid hash', async () => {
    const ir = applyOps(emptyIR(), [
      { kind: 'add_resource', node: newResource('aws_vpc', 'main', { cidr_block: '10.0.0.0/16' }) },
    ]);
    const hash = encodeIR(ir);
    renderWithRouter(<PlaygroundRoute />, { route: `/p/${hash}`, path: '/p/:hash' });
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        /Loaded from a shared URL/i,
      );
    });
    const fork = screen.getAllByRole('link', { name: /Fork to edit/i });
    expect(fork.length).toBeGreaterThan(0);
    expect(fork[0]?.getAttribute('href')).toBe('/dashboard');
  });

  it('shows a friendly error card for a malformed hash', () => {
    renderWithRouter(<PlaygroundRoute />, {
      route: '/p/totally-bogus-hash',
      path: '/p/:hash',
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/unreadable/i);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/dashboard')).toBe(true);
  });
});

describe('TemplatesGallery', () => {
  it('renders the bundled catalog, supports search and provider filtering', async () => {
    const onPick = vi.fn();
    renderWithRouter(
      <TemplatesGallery open onClose={() => {}} onPick={onPick} onStartScratch={() => {}} />,
    );
    // Wait for the initial state (offline pill or grid).
    await waitFor(() => {
      expect(screen.getByText(/Web App on AWS/i)).toBeInTheDocument();
    });
    // 5 bundled templates initially.
    expect(screen.getAllByText(/Use template/i).length).toBeGreaterThanOrEqual(5);

    // Filter to GCP — only 1 template matches.
    await userEvent.click(screen.getByRole('button', { name: 'GCP' }));
    expect(screen.getByText(/Static Site on GCP/i)).toBeInTheDocument();
    expect(screen.queryByText(/Web App on AWS/i)).not.toBeInTheDocument();

    // Reset + search.
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    const search = screen.getByLabelText('Search templates');
    await userEvent.type(search, 'container');
    expect(screen.getByText(/Container Stack on AWS/i)).toBeInTheDocument();
    expect(screen.queryByText(/Web App on AWS/i)).not.toBeInTheDocument();
  });

  it('invokes onPick with the slug when "Use template" is clicked', async () => {
    const onPick = vi.fn();
    renderWithRouter(
      <TemplatesGallery open onClose={() => {}} onPick={onPick} onStartScratch={() => {}} />,
    );
    await waitFor(() => screen.getByRole('button', { name: 'Use template Web App on AWS' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use template Web App on AWS' }));
    expect(onPick).toHaveBeenCalledWith('web-app-aws');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    renderWithRouter(<TemplatesGallery open onClose={onClose} onPick={() => {}} />);
    await waitFor(() => screen.getByText(/Web App on AWS/i));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
