import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BalanceWithPending, PendingProjectionNote } from './BalanceWithPending';

// Thursday 19 Nov 2026, 9:45 a.m. at the school (UTC-6).
const NOW = new Date('2026-11-19T15:45:00Z');
const FRIDAY_0730 = '2026-11-20T13:30:00Z';
const MONDAY_0730 = '2026-11-23T13:30:00Z';
const paid = (amount: string, apply_due_at: string | null = FRIDAY_0730) => ({ amount, apply_due_at });

const srText = (container: HTMLElement) => container.querySelector('.sr-only')?.textContent;

describe('BalanceWithPending', () => {
  it('nothing pending: the plain label and figure, no arrow, no extra line', () => {
    for (const pending of [undefined, null, []]) {
      const { container, unmount } = render(<BalanceWithPending balance="150.00" pending={pending} now={NOW} />);
      expect(screen.getByText('Saldo')).toBeInTheDocument();
      expect(screen.getByText('$150.00')).toBeInTheDocument();
      expect(container.querySelector('svg')).toBeNull();
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(srText(container)).toBeUndefined();
      expect(screen.queryByText(/pagada/)).toBeNull();
      unmount();
    }
  });

  it('one paid top-up: real balance first, the projection after a decorative arrow', () => {
    const { container } = render(<BalanceWithPending balance="150.00" pending={[paid('200.00')]} now={NOW} />);
    expect(screen.getByText('Saldo en caja')).toBeInTheDocument();
    const real = screen.getByText('$150.00');
    const projected = screen.getByText('$350.00');
    // The real balance stays the hero: bigger type than the projection.
    expect(real.className).toMatch(/text-2xl/);
    expect(projected.className).toMatch(/text-base/);
    expect(projected.className).toMatch(/text-green-dark/);
    expect(real.compareDocumentPosition(projected) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The arrow and the figures are hidden from screen readers...
    const arrow = container.querySelector('svg');
    expect(arrow?.getAttribute('aria-hidden')).toBe('true');
    expect(real.closest('[aria-hidden="true"]')).not.toBeNull();
    // ...which get one sentence instead.
    expect(srText(container)).toBe(
      'Saldo actual $150.00. Con la recarga pagada de $200.00 será $350.00 a partir de mañana viernes 20 de noviembre a las 7:30 a.m.',
    );
    // The word «pagada» is always written: nothing relies on colour alone.
    expect(screen.getByText('Recarga de $200.00 pagada · disponible mañana a las 7:30 a.m.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/—/);
  });

  it('several top-ups on the same day: their sum, one line', () => {
    const { container } = render(
      <BalanceWithPending balance="150.00" pending={[paid('100.00'), paid('200.00')]} expandable now={NOW} />,
    );
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText('2 recargas pagadas por $300.00 · disponibles mañana a las 7:30 a.m.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(srText(container)).toBe(
      'Saldo actual $150.00. Con las 2 recargas pagadas por $300.00 será $450.00 a partir de mañana viernes 20 de noviembre a las 7:30 a.m.',
    );
  });

  it('several load days: one summary up to the last one, the details behind «Ver detalle»', () => {
    const { container } = render(
      <BalanceWithPending balance="150.00" pending={[paid('200.00', MONDAY_0730), paid('100.00', FRIDAY_0730)]} expandable now={NOW} />,
    );
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText(
      '2 recargas pagadas por $300.00 · todo disponible el lunes 23 de noviembre a las 7:30 a.m.',
    )).toBeInTheDocument();
    expect(srText(container)).toBe(
      'Saldo actual $150.00. Con las 2 recargas pagadas por $300.00 será $450.00 a partir del lunes 23 de noviembre a las 7:30 a.m.',
    );
    const toggle = screen.getByRole('button', { name: 'Ver detalle de las recargas pagadas' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.className).toMatch(/min-h-\[44px\]/);
    expect(toggle.className).toMatch(/focus-visible:ring-2/);
    const list = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement;
    expect(list).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(list).toBeVisible();
    // In load order whatever order the API sent, each with the balance it leaves.
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Mañana a las 7:30 a.m.: $250.00 · recarga de $100.00 pagada',
      'El lunes 23 de noviembre a las 7:30 a.m.: $450.00 · recarga de $200.00 pagada',
    ]);
  });

  it('several load days without the toggle: the summary alone', () => {
    render(<BalanceWithPending balance="150.00" pending={[paid('100.00'), paid('200.00', MONDAY_0730)]} now={NOW} />);
    expect(screen.getByText(/todo disponible el lunes 23 de noviembre/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('adds in whole cents: $0.10 + $0.20 is $0.30', () => {
    const { container } = render(<BalanceWithPending balance="0.00" pending={[paid('0.10'), paid('0.20')]} now={NOW} />);
    expect(screen.getByText('$0.30')).toBeInTheDocument();
    expect(screen.getByText('2 recargas pagadas por $0.30 · disponibles mañana a las 7:30 a.m.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0000/);
  });

  it('a paid top-up larger than a negative balance', () => {
    const { container } = render(<BalanceWithPending balance="-50.00" pending={[paid('200.00')]} now={NOW} />);
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    expect(srText(container)).toMatch(/^Saldo actual -\$50\.00\. Con la recarga pagada de \$200\.00 será \$150\.00/);
  });

  it('large wallets keep their thousands separators', () => {
    render(<BalanceWithPending balance="12345.67" pending={[paid('200.00')]} now={NOW} />);
    expect(screen.getByText('$12,345.67')).toBeInTheDocument();
    expect(screen.getByText('$12,545.67')).toBeInTheDocument();
  });

  it('ignores rows with nothing to add, and the arrow goes once the top-up is applied', () => {
    const { container, rerender } = render(
      <BalanceWithPending balance="150.00" pending={[paid('0.00'), paid('abc')]} now={NOW} />,
    );
    expect(container.querySelector('svg')).toBeNull();
    rerender(<BalanceWithPending balance="150.00" pending={[paid('200.00')]} now={NOW} />);
    expect(screen.getByText('$350.00')).toBeInTheDocument();
    // Applied (or refunded): the backend stops listing it and the balance moves.
    rerender(<BalanceWithPending balance="350.00" pending={[]} now={NOW} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('$350.00')).toBeInTheDocument();
    expect(screen.getByText('Saldo')).toBeInTheDocument();
  });

  it('past its promised time: no date already gone', () => {
    const { container } = render(<BalanceWithPending balance="150.00" pending={[paid('200.00', '2026-11-18T13:30:00Z')]} now={NOW} />);
    expect(screen.getByText('Recarga de $200.00 pagada · disponible en la próxima carga del colegio')).toBeInTheDocument();
    expect(srText(container)).toMatch(/será \$350\.00 a partir de la próxima carga del colegio\.$/);
  });

  it('low balance colours the real figure only', () => {
    render(<BalanceWithPending balance="5.00" pending={[paid('10.00')]} low now={NOW} />);
    expect(screen.getByText('$5.00').className).toMatch(/text-amber/);
    expect(screen.getByText('$15.00').className).not.toMatch(/text-amber/);
  });

  it('the credential: projection in a white pill, the line goes elsewhere', () => {
    render(<BalanceWithPending variant="credential" balance="150.00" pending={[paid('200.00')]} now={NOW} />);
    expect(screen.getByText('$350.00').className).toMatch(/bg-white/);
    expect(screen.queryByText(/Recarga de \$200\.00 pagada/)).toBeNull();
  });

  it('custom labels and a caption under the figures', () => {
    render(
      <BalanceWithPending variant="hero" balance="150.00" pending={[paid('200.00')]} label="Saldo de Ana"
        pendingLabel="Saldo en caja de Ana" caption={<p>Ana Ejemplo Uno</p>} now={NOW} />,
    );
    expect(screen.getByText('Saldo en caja de Ana')).toBeInTheDocument();
    expect(screen.getByText('Ana Ejemplo Uno')).toBeInTheDocument();
  });
});

describe('PendingProjectionNote', () => {
  it('renders nothing without pending top-ups', () => {
    const { container } = render(<PendingProjectionNote balance="150.00" pending={[]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is the same short line, hidden from screen readers (the figures carry the sentence)', () => {
    render(<PendingProjectionNote balance="150.00" pending={[paid('200.00')]} now={NOW} />);
    const line = screen.getByText('Recarga de $200.00 pagada · disponible mañana a las 7:30 a.m.');
    expect(line).toHaveAttribute('aria-hidden', 'true');
  });
});
