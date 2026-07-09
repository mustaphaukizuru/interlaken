/** Shape of GET /api/v1/portal/analytics/ (apps/portal/analytics.py). */

export interface AdmissionsDayPoint { date: string; count: number }
export interface PaymentsDayPoint { date: string; total: number }
export interface CafeteriaDayPoint { date: string; topups: number; purchases: number }

export interface AnalyticsPayload {
  admissions: {
    pre_funnel: { pending: number; contacted: number; enrolled: number; rejected: number };
    reg_funnel: Record<string, number>;
    referrals: { source: string; count: number }[];
    series: AdmissionsDayPoint[];
  };
  payments: {
    this_month: { total: number; count: number };
    last_month: { total: number; count: number };
    overdue: { count: number; amount: number };
    series: PaymentsDayPoint[];
  };
  cafeteria: { series: CafeteriaDayPoint[] };
  documents: { in_review: number };
  circulars: { active: number; read_rate: number | null };
  arco: { open: number; overdue: number };
  generated_at: string;
}
