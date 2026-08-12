import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface Props {
  value: string;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

/**
 * Code128 barcode of the student's Loyverse customer code — the same symbology
 * the cafetería POS scans to identify/charge the student. Rendered client-side
 * (works offline via the PWA); no image request.
 */
export function Barcode({ value, height = 64, fontSize = 15, displayValue = true, className = '' }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        height,
        displayValue,
        fontSize,
        margin: 4,
        background: 'transparent',
        lineColor: '#111827',
      });
    } catch {
      // Non-encodable value — leave the svg empty rather than throw.
    }
  }, [value, height, fontSize, displayValue]);

  return <svg ref={ref} className={className} role="img" aria-label={`Código ${value}`} />;
}
