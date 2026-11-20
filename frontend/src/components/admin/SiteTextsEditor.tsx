/**
 * Navegación → «Textos del sitio»: site-wide copy that is not part of one
 * page (cookie banner, prefilled WhatsApp messages, contact bubble, footer
 * legal links, the privacy note under forms, the admission steps, the
 * offline page). Stored in SiteSettings.chrome next to the header/footer
 * form, which keeps its own keys (lib/siteChrome mergeChrome). A text left
 * as the original is not stored, so the site keeps following the built-in
 * copy; «Restablecer» per text or per group puts the original back.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import { LAYOUT_TEXT_DEFAULTS, LEGAL_LINKS_DEFAULT, type FooterLink, type SiteTextKey } from '@/lib/siteChrome';
import { mergeChrome } from '@/lib/chromeMerge';
import { WA_DEFAULTS } from '@/lib/whatsapp';
import { COOKIE_DEFAULTS } from '@/components/CookieBanner';
import { FLOAT_DEFAULTS } from '@/components/ui/WhatsAppFloat';
import { PASSWORD_REQUEST_MESSAGE } from '@/components/portal/PasswordHelp';
import { PRIVACY_NOTE_DEFAULTS } from '@/components/ui/PrivacyNote';
import { FUNNEL_DEFAULTS } from '@/components/admissions/FunnelHero';

/** The built-in text of public/offline.html (keep both in sync). */
export const OFFLINE_DEFAULTS = {
  offline_title: 'Sin conexión a',
  offline_accent: 'internet',
  offline_text: 'No pudimos cargar esta página. Verifique su conexión Wi-Fi o de datos móviles e intente de nuevo. Cuando la conexión regrese, el portal se mostrará normalmente.',
  offline_retry: 'Reintentar',
  offline_home: 'Ir al portal',
} as const;

interface TextField { key: SiteTextKey; label: string; builtIn: string; max: number; long?: boolean; hint?: string }
interface TextGroup { id: string; title: string; where: string; fields: TextField[]; links?: boolean }

/** Max lengths mirror backend/apps/content/navigation.py SITE_TEXTS. */
export const SITE_TEXT_GROUPS: TextGroup[] = [
  {
    id: 'cookies', title: 'Aviso de cookies', where: 'La franja que aparece abajo de la pantalla la primera vez que alguien visita el sitio.',
    fields: [
      { key: 'cookie_text', label: 'Texto del aviso', builtIn: COOKIE_DEFAULTS.cookie_text, max: 400, long: true },
      { key: 'cookie_link', label: 'Enlace al aviso de privacidad', builtIn: COOKIE_DEFAULTS.cookie_link, max: 60 },
      { key: 'cookie_decline', label: 'Botón para rechazar', builtIn: COOKIE_DEFAULTS.cookie_decline, max: 30 },
      { key: 'cookie_accept', label: 'Botón para aceptar', builtIn: COOKIE_DEFAULTS.cookie_accept, max: 30 },
    ],
  },
  {
    id: 'whatsapp', title: 'Mensajes de WhatsApp', where: 'El texto con el que se abre la conversación cuando una familia toca un botón de WhatsApp. {{ciclo}} pone el ciclo escolar.',
    fields: [
      { key: 'wa_admissions', label: 'Admisiones (botón «Informes» del proceso)', builtIn: WA_DEFAULTS.wa_admissions, max: 400, long: true },
      { key: 'wa_visit', label: 'Barra inferior del teléfono («Agendar visita»)', builtIn: WA_DEFAULTS.wa_visit, max: 400, long: true },
      { key: 'wa_float', label: 'Burbuja de contacto', builtIn: FLOAT_DEFAULTS.wa_float, max: 400, long: true },
      { key: 'wa_password', label: 'Solicitar contraseña del portal', builtIn: PASSWORD_REQUEST_MESSAGE, max: 400, long: true, hint: 'También se usa como texto del correo para pedir la contraseña.' },
      { key: 'wa_estimator', label: 'Estimador de costos', builtIn: WA_DEFAULTS.wa_estimator, max: 400, long: true, hint: '{seccion} se reemplaza por la sección que eligió la familia.' },
    ],
  },
  {
    id: 'bubble', title: 'Burbuja de contacto y menú', where: 'La burbuja verde de la esquina y las palabras fijas del encabezado.',
    fields: [
      { key: 'float_whatsapp', label: 'Burbuja: opción de WhatsApp', builtIn: FLOAT_DEFAULTS.float_whatsapp, max: 40 },
      { key: 'float_visit', label: 'Burbuja: opción de agendar visita', builtIn: FLOAT_DEFAULTS.float_visit, max: 40 },
      { key: 'float_password', label: 'Burbuja: opción de contraseña', builtIn: FLOAT_DEFAULTS.float_password, max: 40 },
      { key: 'nav_contact', label: 'Menú: enlace a Contacto', builtIn: LAYOUT_TEXT_DEFAULTS.nav_contact, max: 40 },
      { key: 'skip_link', label: 'Enlace «saltar al contenido» (teclado)', builtIn: LAYOUT_TEXT_DEFAULTS.skip_link, max: 60, hint: 'Solo se ve al navegar con el teclado.' },
    ],
  },
  {
    id: 'footer', title: 'Pie de página', where: 'La columna de contacto y los enlaces legales de la franja inferior. Las demás columnas son los grupos del menú.',
    fields: [
      { key: 'footer_contact', label: 'Título de la columna de contacto', builtIn: LAYOUT_TEXT_DEFAULTS.footer_contact, max: 40 },
    ],
    links: true,
  },
  {
    id: 'privacy', title: 'Aviso de privacidad en formularios', where: 'La línea con el escudo que aparece arriba del botón de envío de los formularios del sitio.',
    fields: [
      { key: 'privacy_note', label: 'Texto', builtIn: PRIVACY_NOTE_DEFAULTS.privacy_note, max: 400, long: true },
      { key: 'privacy_link', label: 'Enlace al aviso', builtIn: PRIVACY_NOTE_DEFAULTS.privacy_link, max: 60 },
    ],
  },
  {
    id: 'funnel', title: 'Pasos de admisión', where: 'Las cuatro casillas de las portadas de Pre-registro, Agendar visita e Inscripción.',
    fields: [
      { key: 'funnel_1', label: 'Paso 1', builtIn: FUNNEL_DEFAULTS.funnel_1, max: 30 },
      { key: 'funnel_2', label: 'Paso 2', builtIn: FUNNEL_DEFAULTS.funnel_2, max: 30 },
      { key: 'funnel_3', label: 'Paso 3', builtIn: FUNNEL_DEFAULTS.funnel_3, max: 30 },
      { key: 'funnel_4', label: 'Paso 4', builtIn: FUNNEL_DEFAULTS.funnel_4, max: 30 },
      { key: 'funnel_now', label: 'Etiqueta del paso actual', builtIn: FUNNEL_DEFAULTS.funnel_now, max: 20 },
      { key: 'funnel_done', label: 'Etiqueta de un paso terminado', builtIn: FUNNEL_DEFAULTS.funnel_done, max: 20 },
      { key: 'funnel_next', label: 'Etiqueta de un paso pendiente', builtIn: FUNNEL_DEFAULTS.funnel_next, max: 20 },
    ],
  },
  {
    id: 'offline', title: 'Página sin conexión', where: 'Se muestra cuando no hay internet. Cada teléfono recibe el texto nuevo la próxima vez que abre el sitio con conexión.',
    fields: [
      { key: 'offline_title', label: 'Título', builtIn: OFFLINE_DEFAULTS.offline_title, max: 80 },
      { key: 'offline_accent', label: 'Título: palabra en color', builtIn: OFFLINE_DEFAULTS.offline_accent, max: 40 },
      { key: 'offline_text', label: 'Texto', builtIn: OFFLINE_DEFAULTS.offline_text, max: 400, long: true },
      { key: 'offline_retry', label: 'Botón para reintentar', builtIn: OFFLINE_DEFAULTS.offline_retry, max: 40 },
      { key: 'offline_home', label: 'Botón al portal', builtIn: OFFLINE_DEFAULTS.offline_home, max: 40 },
    ],
  },
];

/** Every chrome key this editor owns (the header/footer form keeps the rest). */
export const SITE_TEXT_KEYS: string[] = [...SITE_TEXT_GROUPS.flatMap((g) => g.fields.map((fd) => fd.key)), 'legal_links'];

type Texts = Partial<Record<SiteTextKey, string>>;
const validHref = (h: string) => /^(\/|https:\/\/)/.test(h.trim());
const sameLinks = (a: FooterLink[], b: FooterLink[]) => JSON.stringify(a) === JSON.stringify(b);

/** What gets stored: only texts that differ from the original (blank = original). */
export function sitePatch(texts: Texts, links: FooterLink[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const g of SITE_TEXT_GROUPS) {
    for (const fd of g.fields) {
      const v = (texts[fd.key] ?? '').trim();
      if (v && v !== fd.builtIn) out[fd.key] = v;
    }
  }
  const clean = links.map((l) => ({ label: l.label.trim(), href: l.href.trim() })).filter((l) => l.label || l.href);
  if (clean.length && !sameLinks(clean, LEGAL_LINKS_DEFAULT)) out.legal_links = clean;
  return out;
}

export function SiteTextsEditor() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-site-settings'],
    queryFn: async () => (await contentApi.adminGetSettings()).data as { chrome?: Record<string, unknown> },
  });
  const stored = useMemo(() => (data?.chrome ?? {}) as Record<string, unknown>, [data]);
  const [texts, setTexts] = useState<Texts | null>(null);
  const [links, setLinks] = useState<FooterLink[] | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<Partial<Record<string, string>>>({});

  const current = (fd: TextField) => texts?.[fd.key] ?? (typeof stored[fd.key] === 'string' && (stored[fd.key] as string).trim() ? (stored[fd.key] as string) : fd.builtIn);
  const storedLinks = Array.isArray(stored.legal_links) && stored.legal_links.length ? (stored.legal_links as FooterLink[]) : LEGAL_LINKS_DEFAULT;
  const linkList = links ?? storedLinks;
  const dirty = texts !== null || links !== null;
  const allTexts = (): Texts => Object.fromEntries(SITE_TEXT_GROUPS.flatMap((g) => g.fields.map((fd) => [fd.key, current(fd)])));

  const setText = (key: SiteTextKey, value: string) => { setTexts({ ...(texts ?? {}), [key]: value }); setFieldError((e) => ({ ...e, [key]: undefined })); };
  const setLink = (i: number, patch: Partial<FooterLink>) => { setLinks(linkList.map((l, j) => (j === i ? { ...l, ...patch } : l))); setFieldError((e) => ({ ...e, [`link-${i}`]: undefined })); };

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => contentApi.adminUpdateSettings({ chrome: mergeChrome(stored, SITE_TEXT_KEYS, patch) }),
    onSuccess: (res) => {
      toast.success('Textos del sitio guardados. El sitio los muestra en unos minutos.');
      setError(''); setTexts(null); setLinks(null); setFieldError({});
      const chrome = (res?.data as { chrome?: Record<string, unknown> } | undefined)?.chrome;
      if (chrome) qc.setQueryData<{ chrome?: Record<string, unknown> }>(['admin-site-settings'], (prev) => (prev ? { ...prev, chrome } : prev));
      qc.invalidateQueries({ queryKey: ['admin-site-settings'] }); qc.invalidateQueries({ queryKey: ['site-settings'] });
    },
    onError: (e) => {
      const f = apiFieldErrors(e);
      const msg = f.chrome || f.detail || 'No se pudieron guardar los textos.';
      // The server names the text it refused («"cookie_accept": máximo 30 caracteres.»): show it there.
      const key = /^"(\w+)"/.exec(msg)?.[1];
      if (key) setFieldError({ [key]: msg.replace(/^"\w+":\s*/, '') });
      setError(key ? 'Revise el texto marcado.' : msg);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    linkList.forEach((l, i) => {
      if (!l.label.trim() && !l.href.trim()) return;
      if (!l.label.trim()) errs[`link-${i}`] = 'Escriba el texto del enlace.';
      else if (!validHref(l.href)) errs[`link-${i}`] = 'El enlace debe empezar con / o con https://.';
    });
    setFieldError(errs);
    if (Object.keys(errs).length) { setError('Revise los enlaces marcados.'); return; }
    save.mutate(sitePatch(allTexts(), linkList));
  };

  const resetGroup = (g: TextGroup) => {
    const next = { ...(texts ?? allTexts()) };
    g.fields.forEach((fd) => { next[fd.key] = fd.builtIn; });
    setTexts(next);
    if (g.links) setLinks(LEGAL_LINKS_DEFAULT);
  };

  if (isLoading) return <Card><ListSkeleton /></Card>;
  if (isError && !data) return <Card><ErrorState title="No se pudieron cargar los textos del sitio" onRetry={() => refetch()} /></Card>;

  return (
    <Card title="Textos del sitio" subtitle="Textos que se repiten en todas las páginas. Cambie lo que necesite; «Restablecer» vuelve al texto original.">
      <form onSubmit={submit} className="space-y-3" noValidate>
        {SITE_TEXT_GROUPS.map((g) => {
          const changed = g.fields.filter((fd) => current(fd).trim() !== fd.builtIn).length + (g.links && !sameLinks(linkList, LEGAL_LINKS_DEFAULT) ? 1 : 0);
          const hasError = g.fields.some((fd) => fieldError[fd.key]) || (g.links && linkList.some((_, i) => fieldError[`link-${i}`]));
          return (
            <details key={g.id} className="group rounded-xl border border-line bg-white open:shadow-card" open={hasError || undefined}>
              <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{g.title}</span>
                  <span className="block text-xs text-muted">{g.where}</span>
                </span>
                {changed > 0 && <Badge variant="info">{changed === 1 ? '1 cambiado' : `${changed} cambiados`}</Badge>}
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <div className="space-y-4 border-t border-line px-4 py-4">
                {g.fields.map((fd) => {
                  const id = `site-text-${fd.key}`;
                  const value = current(fd);
                  const isChanged = value.trim() !== fd.builtIn;
                  const err = fieldError[fd.key];
                  return (
                    <div key={fd.key}>
                      {fd.long ? (
                        <div>
                          <label className="label" htmlFor={id}>{fd.label}</label>
                          <textarea id={id} className={`input-field min-h-[88px] text-sm ${err ? 'border-coral-400' : ''}`} maxLength={fd.max} value={value}
                            aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-error` : fd.hint ? `${id}-hint` : undefined}
                            onChange={(e) => setText(fd.key, e.target.value)} />
                          {err ? <p id={`${id}-error`} className="mt-1.5 text-xs text-coral-600">{err}</p> : fd.hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{fd.hint}</p>}
                        </div>
                      ) : (
                        <Input id={id} label={fd.label} value={value} maxLength={fd.max} hint={fd.hint} error={err} onChange={(e) => setText(fd.key, e.target.value)} />
                      )}
                      {isChanged && (
                        <button type="button" className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-purple hover:underline sm:min-h-[32px]" onClick={() => setText(fd.key, fd.builtIn)}>
                          <RotateCcw size={12} aria-hidden="true" /> Restablecer «{fd.builtIn.length > 48 ? `${fd.builtIn.slice(0, 48)}…` : fd.builtIn}»
                        </button>
                      )}
                    </div>
                  );
                })}
                {g.links && (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-ink">Enlaces legales de la franja inferior (máximo 4)</legend>
                    {linkList.map((l, i) => (
                      <div key={i} className="grid items-start gap-2 rounded-lg bg-cream-2 p-2 sm:grid-cols-[1fr_1.4fr_auto]">
                        <Input id={`legal-label-${i}`} label="Texto del enlace" value={l.label} maxLength={60} onChange={(e) => setLink(i, { label: e.target.value })} />
                        <Input id={`legal-href-${i}`} label="Enlace (ruta o URL)" value={l.href} placeholder="/aviso-de-privacidad o https://…" error={fieldError[`link-${i}`]} onChange={(e) => setLink(i, { href: e.target.value })} />
                        <Button type="button" variant="ghost" className="min-h-[44px] sm:mt-6" aria-label={`Quitar el enlace ${l.label || i + 1}`} onClick={() => setLinks(linkList.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></Button>
                      </div>
                    ))}
                    {linkList.length < 4 && (
                      <Button type="button" size="sm" variant="secondary" className="min-h-[44px]" onClick={() => setLinks([...linkList, { label: '', href: '' }])}><Plus size={14} aria-hidden="true" /> Agregar enlace</Button>
                    )}
                    {linkList.length === 0 && <p className="text-xs text-muted">Sin enlaces, el pie muestra «Aviso de Privacidad».</p>}
                  </fieldset>
                )}
                {changed > 0 && (
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="ghost" className="min-h-[44px]" onClick={() => resetGroup(g)}><RotateCcw size={14} aria-hidden="true" /> Restablecer «{g.title}»</Button>
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {error && <p className="text-sm text-coral-600" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {dirty && <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => { setTexts(null); setLinks(null); setFieldError({}); setError(''); }}>Descartar cambios</Button>}
          <Button type="submit" className="min-h-[44px]" loading={save.isPending} disabled={!dirty}>Guardar textos</Button>
        </div>
      </form>
    </Card>
  );
}

export default SiteTextsEditor;
