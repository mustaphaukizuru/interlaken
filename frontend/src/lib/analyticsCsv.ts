/**
 * analyticsCsv.ts — client-side CSV export of the staff analytics payload
 * (IK-ADMIN dashboard round 2). One merged daily table: every series shares
 * the same date axis, so directors get a single spreadsheet-ready file.
 */
import { downloadBlob } from '@/services/api';
import type { AnalyticsPayload } from '@/types/analytics';

export function analyticsToCsv(data: AnalyticsPayload): string {
  const lines = ['fecha,pre_registros,cobrado_mxn,recargas_cafeteria_mxn,consumo_cafeteria_mxn'];
  data.admissions.series.forEach((point, i) => {
    const pay = data.payments.series[i]?.total ?? 0;
    const caf = data.cafeteria.series[i];
    lines.push([
      point.date,
      point.count,
      pay.toFixed(2),
      (caf?.topups ?? 0).toFixed(2),
      (caf?.purchases ?? 0).toFixed(2),
    ].join(','));
  });
  return lines.join('\r\n');
}

export function downloadAnalyticsCsv(data: AnalyticsPayload): void {
  // '\uFEFF' = UTF-8 BOM so Excel (es-MX) detects the CSV encoding.
  const blob = new Blob(['\uFEFF' + analyticsToCsv(data)],
    { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `analitica-interlaken-${data.range_days}d.csv`);
}
