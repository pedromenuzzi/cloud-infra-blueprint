import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CostBadge, CostTotalBadge } from './CostBadge';

describe('CostBadge', () => {
  it('renders an n/a badge when cost is unknown', () => {
    render(<CostBadge monthlyCost={null} />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('renders a Free label for zero cost', () => {
    render(<CostBadge monthlyCost={0} />);
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('formats sub-$10 costs into the low/green bucket', () => {
    const { container } = render(<CostBadge monthlyCost={1.5} />);
    expect(screen.getByText(/\$1\.50\/mo/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-success/10');
  });

  it('formats $10–$99 costs into the medium/amber bucket', () => {
    const { container } = render(<CostBadge monthlyCost={42} />);
    expect(screen.getByText(/\$42\.00\/mo/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-warning/10');
  });

  it('formats >=$100 costs into the high/red bucket', () => {
    const { container } = render(<CostBadge monthlyCost={250} />);
    expect(screen.getByText(/\$250\.00\/mo/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-danger/10');
  });
});

describe('CostTotalBadge', () => {
  it('renders the total + /mo suffix', () => {
    render(<CostTotalBadge total={123.45} />);
    expect(screen.getByText(/\$123\.45/)).toBeInTheDocument();
    expect(screen.getByText('/ mo')).toBeInTheDocument();
  });
});
