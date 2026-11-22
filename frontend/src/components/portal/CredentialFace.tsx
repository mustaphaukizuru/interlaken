import { useId, useState } from 'react';
import { Barcode } from '@/components/ui/Barcode';
import { gradeBadge, levelOf, photoSrc, schoolCycle, sepLines, type Level } from '@/lib/credential';
import type { CafeteriaCard } from '@/types';

/**
 * The digital credencial: the school's printed student ID (owner,
 * 2026-11-22) laid out as a standard landscape ID card (CR80, 85.6 x 54 mm,
 * like a bank card or a wallet pass). Navy band with the logo, the C.C.T.
 * and the «45 años» mark; the level's colour with the clock-ray pattern;
 * photo, grade, Nombre, Ciclo escolar, Matrícula and a barcode strip the
 * cafetería POS scans.
 *
 * Positions are in artboard units (4050 x 2550, CR80 landscape at 1200 dpi,
 * the template's scale), so the card keeps its proportions at any width;
 * type is sized in container units (index.css, `.credencial`).
 */
const W = 4050;
const H = 2550;
const BAND = 1050; // the navy band's width
const PHOTO = { x: 1250, y: 220, w: 1150, h: 1530 }; // 3:4 portrait
const DATA = { x: 2590, y: 220, w: 1260, h: 1530 };
const STRIP = { x: 1250, y: 1900, w: 2600, h: 430 }; // the barcode strip

const box = (x: number, y: number, w: number, h: number) => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
  width: `${(w / W) * 100}%`,
  height: `${(h / H) * 100}%`,
});

// The template's pattern: the logo's twelve clock rays, repeated on a
// centred grid (556 × 640 tile), a light tint on the level colour. Measured
// on the template: long rays r 120-260 and 38 wide, short ones r 130-200
// and 19 wide (caps included).
const TILE_W = 556;
const TILE_H = 640;
function rays(cx: number, cy: number, long: boolean): string {
  let d = '';
  for (let i = 0; i < 12; i++) {
    if ((i % 3 === 0) !== long) continue;
    const a = (i * Math.PI) / 6;
    const [r1, r2] = long ? [139, 241] : [139.5, 190.5];
    const c = Math.cos(a);
    const s = Math.sin(a);
    d += `M${(cx + r1 * c).toFixed(1)} ${(cy + r1 * s).toFixed(1)}L${(cx + r2 * c).toFixed(1)} ${(cy + r2 * s).toFixed(1)}`;
  }
  return d;
}
const CENTRES = [[0, 0], [TILE_W, 0], [0, TILE_H], [TILE_W, TILE_H], [TILE_W / 2, TILE_H / 2]];
const LONG_RAYS = CENTRES.map(([x, y]) => rays(x, y, true)).join('');
const SHORT_RAYS = CENTRES.map(([x, y]) => rays(x, y, false)).join('');

/** The school's level palette (tailwind `nivel`); Maternal shares Preescolar's. */
const LEVEL_FILL: Record<Level, string> = {
  maternal: 'fill-nivel-preescolar',
  preescolar: 'fill-nivel-preescolar',
  primaria: 'fill-nivel-primaria',
  secundaria: 'fill-nivel-secundaria',
};

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="cred-label font-semibold uppercase tracking-[0.08em]">{label}</dt>
      <dd className={`mt-[0.4cqw] font-bold [overflow-wrap:anywhere] ${className || 'cred-value truncate'}`}>{value}</dd>
    </div>
  );
}

/** The empty frame: a quiet head-and-shoulders, as on a blank ID. */
function NoPhoto() {
  return (
    <svg viewBox="0 0 100 130" className="h-full w-full" aria-hidden="true" focusable="false">
      <rect width="100" height="130" className="fill-cream" />
      <circle cx="50" cy="52" r="22" className="fill-credencial-navy/15" />
      <path d="M8 130c3-28 20-42 42-42s39 14 42 42z" className="fill-credencial-navy/15" />
    </svg>
  );
}

export function CredentialFace({ card, className = '' }: { card: CafeteriaCard; className?: string }) {
  const s = card.student;
  const staff = s.tipo === 'personal';
  const level = staff ? null : levelOf(s.grade);
  const badge = staff
    ? (s.puesto && s.puesto !== 'sin_asignar' && s.puesto_label) || 'Personal del colegio'
    : gradeBadge(s.grade, s.group) || 'Alumno';
  const sep = sepLines(level);
  // Staff and an alumno with no level: the brand's lavender, so no level
  // colour is ever claimed by mistake.
  const fill = level ? LEVEL_FILL[level] : 'fill-purple-xlight';
  const patternId = `cred-rays-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [failed, setFailed] = useState<string | null>(null);
  const photo = s.photo && failed !== s.photo ? photoSrc(s.photo) : '';

  return (
    <section
      aria-label={`Credencial de ${s.name}`}
      className={`credencial relative aspect-[4050/2550] overflow-hidden rounded-md bg-credencial-navy font-head text-credencial-ink shadow-lg ring-1 ring-black/5 [print-color-adjust:exact] print:shadow-none ${className}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" x="1328" y="1275" width={TILE_W} height={TILE_H}>
            <g fill="none" className="stroke-white" strokeOpacity={0.17} strokeLinecap="round">
              <path d={LONG_RAYS} strokeWidth={38} />
              <path d={SHORT_RAYS} strokeWidth={19} />
            </g>
          </pattern>
        </defs>
        <rect width={BAND} height={H} className="fill-credencial-navy" />
        <rect x={BAND} width={W - BAND} height={H} className={fill} />
        <rect x={BAND} width={W - BAND} height={H} fill={`url(#${patternId})`} />
        {/* White mat around the photo and the barcode strip, as on a printed ID. */}
        <rect x={PHOTO.x - 26} y={PHOTO.y - 26} width={PHOTO.w + 52} height={PHOTO.h + 52} rx={44} className="fill-white" />
        <rect x={STRIP.x} y={STRIP.y} width={STRIP.w} height={STRIP.h} rx={44} className="fill-white" />
        <image href="/assets/credencial/logo.webp" x={155} y={190} width={740} height={654} />
        <image href="/assets/credencial/45-anos.webp" x={300} y={1880} width={450} height={526} />
      </svg>

      {/* The navy band: the level's SEP registration under the logo. */}
      {sep && (
        <div className="absolute flex flex-col items-center justify-center text-center text-white" style={box(50, 930, 950, 420)}>
          <p className="cred-sep font-semibold">C.C.T. {sep.cct}</p>
          {sep.lines.map((l) => <p key={l} className={`${l.length > 16 ? 'cred-sep-long' : 'cred-sep'} whitespace-nowrap font-light`}>{l}</p>)}
        </div>
      )}

      <div className="absolute overflow-hidden rounded-sm bg-white" style={box(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h)}>
        {photo ? (
          <img
            src={photo}
            alt={`Foto de ${s.name}`}
            referrerPolicy="no-referrer"
            decoding="async"
            onError={() => setFailed(s.photo ?? null)}
            className="h-full w-full object-cover"
          />
        ) : (
          <NoPhoto />
        )}
      </div>

      <div className="absolute flex flex-col justify-between" style={box(DATA.x, DATA.y, DATA.w, DATA.h)}>
        <span className="cred-pill self-start truncate rounded-full bg-credencial-navy px-[1.6cqw] py-[0.7cqw] font-bold text-white">{badge}</span>
        <dl className="flex flex-col gap-[1.6cqw]">
          <Field label="Nombre" value={s.name} className={`${s.name.length > 26 ? 'cred-name-long' : 'cred-name'} line-clamp-3`} />
          <Field label="Ciclo escolar" value={schoolCycle()} />
          <Field label={staff ? 'Código' : 'Matrícula'} value={card.code || '—'} />
        </dl>
      </div>

      <div className="absolute flex items-center justify-center px-[2cqw] py-[1cqw]" style={box(STRIP.x, STRIP.y, STRIP.w, STRIP.h)}>
        {card.code && <Barcode value={card.code} displayValue={false} height={56} className="h-full max-w-full" />}
      </div>

      {/* A soft sheen, as on a laminated card. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-white/0 to-transparent" aria-hidden="true" />
    </section>
  );
}

export default CredentialFace;
