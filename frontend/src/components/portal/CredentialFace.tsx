import { useId, useState } from 'react';
import { Barcode } from '@/components/ui/Barcode';
import { gradeBadge, levelOf, photoSrc, schoolCycle, sepLines, type Level } from '@/lib/credential';
import type { CafeteriaCard } from '@/types';

/**
 * The digital credencial drawn as the school's printed student ID (owner,
 * 2026-11-22): navy band with the logo, the C.C.T. and the «45 años» mark;
 * the level's colour with the clock-ray pattern; grade pill, photo, Nombre,
 * Ciclo Escolar, Matrícula and the barcode the cafetería POS scans.
 *
 * Every position comes from the template's artboard (2550 × 4050, a CR80
 * card portrait at 1200 dpi), so the card keeps its proportions at any
 * width; type is sized in container units (index.css, `.credencial`).
 */
const W = 2550;
const H = 4050;
const BAND = 990; // the navy band's width

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

function Field({ label, value, long = false, first = false }: { label: string; value: string; long?: boolean; first?: boolean }) {
  return (
    <div className={first ? '' : 'cred-gap'}>
      <dt className="cred-label font-light">{label}</dt>
      <dd className={`${long ? 'cred-value-long' : 'cred-value'} line-clamp-3 font-bold [overflow-wrap:anywhere]`}>{value}</dd>
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
      className={`credencial relative aspect-[2550/4050] overflow-hidden rounded-md bg-credencial-navy font-head text-credencial-ink shadow-lg ring-1 ring-black/5 [print-color-adjust:exact] print:shadow-none ${className}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" x="1246" y="1112" width={TILE_W} height={TILE_H}>
            <g fill="none" className="stroke-white" strokeOpacity={0.17} strokeLinecap="round">
              <path d={LONG_RAYS} strokeWidth={38} />
              <path d={SHORT_RAYS} strokeWidth={19} />
            </g>
          </pattern>
        </defs>
        <rect width={BAND} height={H} className="fill-credencial-navy" />
        <rect x={BAND} width={W - BAND} height={H} className={fill} />
        <rect x={BAND} width={W - BAND} height={H} fill={`url(#${patternId})`} />
        <rect x={1095} y={654} width={1218} height={148} rx={74} className="fill-credencial-navy" />
        <rect x={1117} y={3377} width={1163} height={491} className="fill-white" />
        <image href="/assets/credencial/logo.webp" x={150} y={300} width={690} height={610} />
        <image href="/assets/credencial/45-anos.webp" x={227} y={3040} width={536} height={626} />
      </svg>

      {/* The navy band: the level's SEP registration under the logo. */}
      {sep && (
        <div className="absolute text-center text-white" style={box(40, 1105, 910, 420)}>
          <p className="cred-sep font-semibold">C.C.T. {sep.cct}</p>
          {sep.lines.map((l) => <p key={l} className="cred-sep font-light">{l}</p>)}
        </div>
      )}

      <div className="absolute flex items-center justify-center px-[3%] text-white" style={box(1095, 654, 1218, 148)}>
        <span className="cred-pill truncate font-bold">{badge}</span>
      </div>

      <div className="absolute overflow-hidden bg-white" style={box(1175, 865, 1059, 1385)}>
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

      <dl className="absolute flex flex-col items-center justify-center text-center" style={box(1080, 2290, 1248, 1060)}>
        <Field first label="Nombre" value={s.name} long={s.name.length > 30} />
        <Field label="Ciclo Escolar" value={schoolCycle()} />
        <Field label={staff ? 'Código' : 'Matrícula'} value={card.code || '—'} />
      </dl>

      <div className="absolute flex items-center justify-center px-[4%] py-[2.5%]" style={box(1117, 3377, 1163, 491)}>
        {card.code && <Barcode value={card.code} displayValue={false} height={70} className="h-full w-full" />}
      </div>
    </section>
  );
}

export default CredentialFace;
