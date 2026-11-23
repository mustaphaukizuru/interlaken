/**
 * /_design: the living reference of the design system (DEV ONLY).
 *
 * Mounted only when `import.meta.env.DEV` (App.tsx), so it never ships in the
 * production bundle or the PWA precache and is never linked. It shows every
 * token, primitive and state the standard defines (docs/DESIGN.md,
 * docs/decisions/0001-0003) so a reviewer can check them in one place.
 * Email blocks: run `python manage.py render_emails` (backend) and open the
 * files it writes.
 */
import {
  AlertTriangle, Bell, Calendar, ClipboardList, Coffee, CreditCard, FileCheck2, FileText, History,
  Inbox, Landmark, Mail, Megaphone, QrCode, School, Settings, ShieldAlert, UserRound, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';

const SWATCHES: { name: string; token: string; text?: boolean }[] = [
  { name: 'purple (structure, primary action)', token: '--purple' },
  { name: 'pink (marketing CTA)', token: '--pink' },
  { name: 'green-strong (solid success face)', token: '--green-strong' },
  { name: 'coral (warm accent)', token: '--coral' },
  { name: 'amber (warning text)', token: '--amber' },
  { name: 'ink', token: '--text-main' },
  { name: 'muted', token: '--text-muted' },
  { name: 'subtle', token: '--text-light' },
  { name: 'cream (page)', token: '--cream' },
  { name: 'cream-2 (tint)', token: '--cream-2' },
  { name: 'line (hairline)', token: '--border' },
];

const STATUS: { name: string; fg: string; bg: string }[] = [
  { name: 'success', fg: '--success-fg', bg: '--success-bg' },
  { name: 'warning', fg: '--warning-fg', bg: '--warning-bg' },
  { name: 'danger', fg: '--danger-fg', bg: '--danger-bg' },
  { name: 'info', fg: '--info-fg', bg: '--info-bg' },
  { name: 'neutral', fg: '--neutral-fg', bg: '--neutral-bg' },
];

const LAYERS = [
  ['z-raised', '5', 'pinned table cells'],
  ['z-sticky', '30', 'tab bar, sticky CTA bars and footers, WhatsApp button'],
  ['z-header', '35', 'app header, public nav'],
  ['z-dropdown', '40', 'menus, popovers, child picker, drawer backdrop'],
  ['z-drawer', '50', 'sidebar drawer, cookie banner'],
  ['z-modal', '60', 'dialogs, bottom sheets, command palette'],
  ['z-toast', '70', 'toasts'],
  ['z-overlay', '80', 'full-screen credencial, lightbox, skip link'],
];

/** One icon per concept (docs/UIUX-REFINEMENT-PROMPT.md §3.4). */
const ICON_MAP: [string, LucideIcon][] = [
  ['Alumno', UserRound], ['Familia', Users], ['Nivel', School], ['Cafetería', Coffee],
  ['Recarga', Wallet], ['Saldo', Landmark], ['Movimiento', History], ['Pago', CreditCard],
  ['Credencial', QrCode], ['Comunicado', Megaphone], ['Aviso urgente', AlertTriangle],
  ['Visita', Calendar], ['Pre-registro', ClipboardList], ['Documento', FileText],
  ['Ficha', FileCheck2], ['Calendario', Calendar], ['Mensaje', Mail], ['Avisos', Bell],
  ['Auditoría', ShieldAlert], ['Bandeja', Inbox], ['Ajustes', Settings],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-head text-xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <h1 className="font-head text-fluid-3xl font-bold text-ink">Sistema de diseño</h1>
        <p className="text-muted">Referencia interna (solo desarrollo). Fuente: docs/DESIGN.md y docs/decisions.</p>
      </header>

      <Section title="Color">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map((s) => (
            <div key={s.token} className="rounded-md bg-white p-3 shadow-card">
              <div className="h-12 rounded-sm" style={{ background: `var(${s.token})` }} />
              <p className="mt-2 text-sm font-semibold text-ink">{s.name}</p>
              <p className="text-xs text-muted">{s.token}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {STATUS.map((s) => (
            <span key={s.name} className="rounded-sm px-3 py-2 text-sm font-semibold"
              style={{ color: `var(${s.fg})`, background: `var(${s.bg})` }}>
              {s.name}: {s.fg} / {s.bg}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Forma y elevación">
        <div className="flex flex-wrap items-end gap-4">
          <div className="h-16 w-28 rounded-sm bg-white shadow-card" /><span className="text-sm text-muted">rounded-sm · 8 px · controles</span>
          <div className="h-16 w-28 rounded-md bg-white shadow-card" /><span className="text-sm text-muted">rounded-md · 12 px · superficies</span>
          <div className="h-16 w-28 rounded-md bg-white shadow-raised" /><span className="text-sm text-muted">shadow-raised · menús y diálogos</span>
        </div>
      </Section>

      <Section title="Capas">
        <table className="w-full max-w-2xl text-left text-sm">
          <thead><tr className="text-muted"><th className="py-1">Clase</th><th>Valor</th><th>Uso</th></tr></thead>
          <tbody>
            {LAYERS.map(([c, v, u]) => (
              <tr key={c} className="border-t border-line"><td className="py-1.5 font-mono">{c}</td><td className="tabular-nums">{v}</td><td>{u}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Botones">
        <div className="flex flex-wrap gap-3">
          <Button>Guardar cambios</Button>
          <Button variant="cta">Agendar visita</Button>
          <Button variant="secondary">Ver detalle</Button>
          <Button variant="green">Recargar saldo</Button>
          <Button variant="danger">Eliminar</Button>
          <Button variant="ghost">Cancelar</Button>
          <Button loading>Guardando</Button>
          <Button disabled>No disponible</Button>
        </div>
      </Section>

      <Section title="Insignias (estado)">
        <div className="flex flex-wrap gap-3">
          <Badge variant="success">Aplicada</Badge>
          <Badge variant="warning">Por verificar</Badge>
          <Badge variant="error">Rechazada</Badge>
          <Badge variant="info">En revisión</Badge>
          <Badge variant="neutral">Borrador</Badge>
        </div>
      </Section>

      <Section title="Campos">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Input label="Correo" type="email" autoComplete="email" placeholder="correo@ejemplo.mx" hint="Le enviaremos la confirmación aquí." />
          <Input label="Teléfono" type="tel" inputMode="tel" autoComplete="tel-national" error="Escriba 10 dígitos." defaultValue="55 12" />
        </div>
      </Section>

      <Section title="Superficies y estados">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Tarjeta" subtitle="Blanca sobre crema, sin borde.">
            <div className="rounded-sm bg-cream-2 p-3 text-sm text-ink">Un bloque interior es un tinte, nunca otra tarjeta.</div>
          </Card>
          <Card><EmptyState icon={Inbox} title="Sin mensajes" description="Cuando una familia escriba, aparecerá aquí." /></Card>
        </div>
      </Section>

      <Section title="Iconos (uno por concepto · 16 / 20 / 24)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {ICON_MAP.map(([label, Icon]) => (
            <div key={label} className="flex items-center gap-2 rounded-sm bg-white p-2.5 text-sm text-ink shadow-card">
              <Icon size={20} aria-hidden="true" className="text-purple" /> {label}
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
