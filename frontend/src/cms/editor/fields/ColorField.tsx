/**
 * Colour field (contract C5 «Colour»): the brand colours (green and coral)
 * first, then the other colours the site already uses, then «Personalizado»
 * with a contrast warning. The stored value is unchanged: a theme variable
 * (`var(--green)`) or a hex colour (`#1f7a3a`), what cmsColor() accepts.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { describedBy, FieldNotes, RequiredMark, type FieldBaseProps } from './FieldShell';

export interface Swatch { value: string; label: string; hex: string }

/** Theme tokens (src/index.css :root). ColorField.test.ts checks these hex values against the stylesheet. */
export const SWATCH_GROUPS: { title: string; items: Swatch[] }[] = [
  { title: 'Colores de la marca', items: [
    { value: 'var(--green)', label: 'Verde', hex: '#47a028' },
    { value: 'var(--green-mid)', label: 'Verde claro', hex: '#6fbb46' },
    { value: 'var(--coral)', label: 'Coral', hex: '#dd2622' },
  ] },
  { title: 'Otros colores del sitio', items: [
    { value: 'var(--purple)', label: 'Morado', hex: '#401a8e' },
    { value: 'var(--purple-mid)', label: 'Morado medio', hex: '#5e3aad' },
    { value: 'var(--pink)', label: 'Rosa', hex: '#e01a4e' },
    { value: 'var(--pink-hot)', label: 'Rosa intenso', hex: '#ec1f7f' },
    { value: 'var(--amber)', label: 'Ámbar', hex: '#b45309' },
  ] },
  { title: 'Colores de los niveles', items: [
    { value: 'var(--nivel-preescolar)', label: 'Preescolar', hex: '#8ac6a4' },
    { value: 'var(--nivel-primaria)', label: 'Primaria', hex: '#f4436c' },
    { value: 'var(--nivel-secundaria)', label: 'Secundaria', hex: '#f1c82f' },
  ] },
];
const ALL_SWATCHES = SWATCH_GROUPS.flatMap((g) => g.items);

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function toRgb(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG contrast ratio of a colour against white (1 to 21). */
export function contrastOnWhite(hex: string): number | null {
  const rgb = toRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05);
}

export const swatchOf = (value: string) => ALL_SWATCHES.find((s) => s.value === value);
export const colorName = (value: string) => swatchOf(value)?.label ?? (HEX_RE.test(value) ? `Personalizado (${value.toLowerCase()})` : value || 'Sin color');

export interface ColorFieldProps extends FieldBaseProps {
  value: string;
  onChange: (v: string) => void;
}

export function ColorField({ id, label, required, hint, error, warning, onBlur, value, onChange }: ColorFieldProps) {
  const isCustom = !!value && !swatchOf(value);
  const [custom, setCustom] = useState(isCustom ? value : '#47a028');
  const [customOpen, setCustomOpen] = useState(isCustom);
  const groupRef = useRef<HTMLDivElement>(null);
  const radios = [...ALL_SWATCHES.map((s) => s.value), '__custom'];
  const selected = isCustom || customOpen ? '__custom' : value;
  const focusIndex = Math.max(0, radios.indexOf(selected));

  const choose = (v: string) => {
    if (v === '__custom') { setCustomOpen(true); if (HEX_RE.test(custom)) onChange(custom); return; }
    setCustomOpen(false);
    onChange(v);
  };
  const onKey = (e: KeyboardEvent) => {
    const i = radios.indexOf((e.target as HTMLElement).dataset.value ?? '');
    if (i < 0) return;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % radios.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + radios.length) % radios.length : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(radios[next]);
    groupRef.current?.querySelector<HTMLElement>(`[data-value="${radios[next]}"]`)?.focus();
  };
  const ratio = isCustom || customOpen ? contrastOnWhite(isCustom ? value : custom) : null;
  const lowContrast = ratio !== null && ratio < 3
    ? `Este color se distingue poco sobre fondo blanco (contraste ${ratio.toFixed(1)} a 1). Para textos, líneas e íconos elija un tono más oscuro.`
    : undefined;
  const labelId = `${id}-label`;

  return (
    <div onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.(); }}>
      <p className="label" id={labelId}>
        {label}<RequiredMark required={required} /><span className="ml-1 font-normal text-subtle">· {colorName(value)}</span>
      </p>
      <div
        ref={groupRef}
        role="radiogroup"
        tabIndex={-1}
        aria-labelledby={labelId}
        aria-describedby={describedBy(id, { hint, error, warning: warning ?? lowContrast })}
        aria-invalid={error ? true : undefined}
        className="space-y-2"
        onKeyDown={onKey}
      >
        {SWATCH_GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{g.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((s) => {
                const on = selected === s.value;
                return (
                  <button
                    key={s.value}
                    id={radios.indexOf(s.value) === focusIndex ? id : undefined}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={s.label}
                    title={s.label}
                    data-value={s.value}
                    tabIndex={radios.indexOf(s.value) === focusIndex ? 0 : -1}
                    onClick={() => choose(s.value)}
                    className={`flex h-11 w-11 items-center justify-center rounded-full ring-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple ${on ? 'ring-2 ring-ink' : 'ring-1 ring-line'}`}
                    style={{ background: s.hex }}
                  >
                    {on && <Check size={18} className={contrastOnWhite(s.hex)! < 2.2 ? 'text-ink' : 'text-white'} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            role="radio"
            id={focusIndex === radios.length - 1 ? id : undefined}
            aria-checked={selected === '__custom'}
            data-value="__custom"
            tabIndex={focusIndex === radios.length - 1 ? 0 : -1}
            onClick={() => choose('__custom')}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple ${selected === '__custom' ? 'border-ink text-ink' : 'border-line text-muted hover:border-purple/50'}`}
          >
            <span className="h-5 w-5 rounded-full ring-1 ring-line" style={{ background: 'conic-gradient(#e01a4e, #f1c82f, #47a028, #401a8e, #e01a4e)' }} aria-hidden="true" />
            Personalizado
          </button>
        </div>
      </div>
      {selected === '__custom' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted" htmlFor={`${id}-picker`}>
            <span className="mb-1 block">Elegir en la paleta</span>
            <input id={`${id}-picker`} type="color" value={HEX_RE.test(custom) && custom.length === 7 ? custom : '#47a028'} onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }} className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-white p-1" />
          </label>
          <label className="text-xs text-muted" htmlFor={`${id}-hex`}>
            <span className="mb-1 block">O escriba el código</span>
            <input
              id={`${id}-hex`}
              className="input-field w-32 font-mono"
              value={custom}
              maxLength={7}
              onChange={(e) => { const v = e.target.value.trim(); setCustom(v); if (HEX_RE.test(v)) onChange(v); }}
              aria-invalid={!HEX_RE.test(custom) || undefined}
              placeholder="#47a028"
            />
          </label>
        </div>
      )}
      {selected === '__custom' && !HEX_RE.test(custom) && <p className="mt-1.5 text-xs text-coral-600">Escriba un código de color como #47a028.</p>}
      <FieldNotes id={id} hint={hint} error={error} warning={warning ?? lowContrast} />
    </div>
  );
}
