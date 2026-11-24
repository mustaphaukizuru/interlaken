import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AnalyticsPayload } from '@/types/analytics';
import ChartsSection from './ChartsSection';

function payload(over: Partial<AnalyticsPayload['admissions']> = {}): AnalyticsPayload {
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 5, 9 + i)).toISOString().slice(0, 10));
  return {
    funnel: [],
    admissions: {
      pre_funnel: { pending: 0, contacted: 0, enrolled: 0, rejected: 0 },
      reg_funnel: {},
      referrals: [],
      series: days.map((date) => ({ date, count: 0 })),
      ...over,
    },
    payments: {
      this_month: { total: 0, count: 0 }, last_month: { total: 0, count: 0 }, last_month_to_date: { total: 0, count: 0 },
      series: days.map((date) => ({ date, total: 0 })),
    },
    cafeteria: { series: days.map((date) => ({ date, topups: 0, purchases: 0 })) },
    documents: { in_review: 0 },
    circulars: { active: 0, read_rate: null },
    arco: { open: 0, overdue: 0 },
    range_days: 30,
    generated_at: '2026-07-08T00:00:00Z',
  };
}

describe('ChartsSection copy (QA 2026-11-24)', () => {
  it('one waiting item reads in the singular', () => {
    render(<ChartsSection data={payload({
      pre_funnel: { pending: 1, contacted: 2, enrolled: 0, rejected: 0 },
      reg_funnel: { submitted: 1, approved: 3 },
    })} />);
    expect(screen.getByText('1 de 3 pre-registros espera primer contacto')).toBeInTheDocument();
    expect(screen.getByText('1 inscripción espera revisión del colegio')).toBeInTheDocument();
  });

  it('subtitles use a colon, never an em-dash', () => {
    const { container } = render(<ChartsSection data={payload()} />);
    for (const text of [
      'Embudo de admisiones: pre-registros por etapa',
      'Inscripciones formales: expedientes por etapa',
      '¿Cómo nos conocieron? Pre-registros por fuente',
      'Cafetería: flujo diario de los últimos 30 días',
      'Ingresos diarios: cafetería y otros cobros',
    ]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.textContent).not.toContain('—');
  });
});
