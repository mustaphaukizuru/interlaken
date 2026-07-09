/**
 * Central chart theme (IK-ADMIN item 7). Every color is read from the token
 * layer at runtime (CSS custom properties in index.css) — charts never carry
 * their own palette. Dark-surface values follow DESIGN.md §1.4: white at
 * opacity steps, composed with color-mix (the sanctioned alpha mechanism).
 */
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export interface ChartTheme {
  /** Max 6 categorical series colors, in assignment order. */
  categorical: string[];
  /** Domain-semantic colors (states, money in vs out). */
  semantic: {
    pending: string;
    contacted: string;
    enrolled: string;
    rejected: string;
    inflow: string;
    outflow: string;
    primary: string;
  };
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  fontFamily: string;
}

export function getChartTheme(dark: boolean): ChartTheme {
  return {
    categorical: [
      cssVar('--purple'),
      cssVar('--green'),
      cssVar('--coral'),
      cssVar('--pink'),
      cssVar('--amber'),
      cssVar('--purple-mid'),
    ],
    semantic: {
      pending: cssVar('--amber'),
      contacted: cssVar('--purple'),
      enrolled: cssVar('--green'),
      rejected: cssVar('--coral'),
      inflow: cssVar('--green'),
      outflow: cssVar('--coral'),
      primary: cssVar('--purple'),
    },
    grid: dark ? 'color-mix(in srgb, white 12%, transparent)' : cssVar('--border'),
    axis: dark ? 'color-mix(in srgb, white 45%, transparent)' : cssVar('--text-light'),
    tooltipBg: dark ? cssVar('--dark-card') : '#ffffff',
    tooltipBorder: dark ? 'color-mix(in srgb, white 12%, transparent)' : cssVar('--border'),
    tooltipText: dark ? 'color-mix(in srgb, white 90%, transparent)' : cssVar('--text-main'),
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

// ── es-MX formatters ──────────────────────────────────────
const mxn0 = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
});
const mxnCompact = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat('es-MX');

export const fmtMXN = (v: number) => mxn0.format(v);
export const fmtMXNCompact = (v: number) => mxnCompact.format(v);
export const fmtInt = (v: number) => int.format(v);
export const fmtDay = (iso: string) => format(parseISO(iso), 'd MMM', { locale: es });
export const fmtPct = (v: number) =>
  `${v > 0 ? '+' : ''}${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(v)}%`;
