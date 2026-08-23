import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FunnelSection, stepRates } from './FunnelSection';
import type { AnalyticsPayload } from '@/types/analytics';

const data = {
  funnel: [{ step: 'pre_registro', label: 'Pre-registros', count: 40 }, { step: 'visita', label: 'Visitas agendadas', count: 10 }, { step: 'inscrito', label: 'Inscritos', count: 5 }],
  cafeteria: { series: [], adoption: { active_students: 200, with_wallet: 150, used_in_period: 75, topped_up_in_period: 30, low_balance: 4, wallet_rate: 0.75, usage_rate: 0.5 } },
  range_days: 30,
} as unknown as AnalyticsPayload;

describe('FunnelSection', () => {
  it('computes step conversion and renders adoption', () => {
    expect(stepRates(data.funnel)).toEqual([100, 25, 50]);
    render(<FunnelSection data={data} />);
    expect(screen.getByText('Pre-registros')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('150 de 200')).toBeInTheDocument();
  });
});
