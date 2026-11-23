/**
 * Link destination picker (contract C5 «Link»). The office picks a page of
 * the site by name (or a section of it), or writes a web address, an e-mail,
 * a phone or a WhatsApp number; the field shows where the link goes. The
 * stored value is the same href string as before.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CornerDownRight, ExternalLink, FileText, Globe, Link2, Mail, MessageCircle, Phone, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { cmsPagePath } from '../../slugPaths';
import { describedBy, FieldLabel, FieldNotes, type FieldBaseProps } from './FieldShell';
import { TextField } from './TextField';
import {
  buildEmail, buildPhone, buildWeb, buildWhatsApp, describeHref, hrefKind, hrefProblem, KIND_LABEL, parseWhatsApp,
  SITE_ANCHORS, SITE_PAGES, type HrefKind, type SitePage,
} from './links';

/** Public pages plus the custom pages made in Contenido (drafts flagged: a link to them is broken until published). */
export function useSitePages(): SitePage[] {
  const { data } = useQuery({
    queryKey: ['admin', 'pages', 'link-targets'],
    queryFn: async () => toPaged<CmsPageAdmin>((await contentApi.adminListPages({ page_size: 200 })).data).results,
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(() => {
    const known = new Set(SITE_PAGES.map((p) => p.path));
    const custom = (data ?? [])
      .filter((p) => !known.has(cmsPagePath(p.slug)) && p.slug !== 'sitio' && p.slug !== 'no-encontrada')
      .map((p): SitePage => ({
        path: cmsPagePath(p.slug),
        title: p.title || p.slug,
        group: 'Páginas creadas en Contenido',
        note: p.status === 'published' ? undefined : 'Esta página todavía no está publicada: el enlace no funcionará hasta publicarla.',
      }));
    return [...SITE_PAGES, ...custom];
  }, [data]);
}

const KIND_ICON = { page: FileText, web: Globe, email: Mail, phone: Phone, whatsapp: MessageCircle, empty: Link2, invalid: Link2 } as const;

type PickKind = Exclude<HrefKind, 'empty' | 'invalid'>;
const PICK_KINDS: PickKind[] = ['page', 'web', 'email', 'phone', 'whatsapp'];

export interface HrefInputProps extends FieldBaseProps {
  value: string;
  onChange: (href: string) => void;
  /** Kinds offered in the picker (default: all). */
  kinds?: PickKind[];
}

/** One destination: a summary of where it goes and a button that opens the picker. */
export function HrefInput({ id, label, required, hint, error, warning, onBlur, value, onChange, kinds = PICK_KINDS }: HrefInputProps) {
  const pages = useSitePages();
  const [open, setOpen] = useState(false);
  const info = describeHref(value, pages);
  const Icon = KIND_ICON[info.kind];
  const problem = error ?? hrefProblem(value) ?? undefined;
  const warn = warning ?? (problem ? undefined : info.warning);
  return (
    <div onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !open) onBlur?.(); }}>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <div className={`flex min-h-[52px] items-center gap-3 rounded-md border bg-white px-3 py-2 ${problem ? 'border-coral-400' : 'border-line'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${info.kind === 'empty' ? 'bg-cream-2 text-subtle' : 'bg-purple/10 text-purple'}`} aria-hidden="true">
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1 [contain:inline-size]">
          <p className={`truncate text-sm font-semibold ${info.kind === 'empty' ? 'text-subtle' : 'text-ink'}`}>{info.title}</p>
          {info.detail && <p className="truncate text-xs text-subtle">{info.detail}</p>}
        </div>
        <Button
          id={id}
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          aria-describedby={describedBy(id, { hint, error: problem, warning: warn })}
          aria-label={`${value ? 'Cambiar' : 'Elegir'} destino de ${label}${value ? ` (ahora: ${info.title})` : ''}`}
        >
          {value ? 'Cambiar' : 'Elegir destino'}
        </Button>
      </div>
      <FieldNotes id={id} hint={hint} error={problem} warning={warn} />
      <LinkPickerDialog
        open={open}
        value={value}
        kinds={kinds}
        pages={pages}
        onClose={() => { setOpen(false); onBlur?.(); }}
        onPick={(href) => { onChange(href); setOpen(false); onBlur?.(); }}
      />
    </div>
  );
}

export interface LinkPickerDialogProps {
  open: boolean;
  value: string;
  onClose: () => void;
  onPick: (href: string) => void;
  kinds?: PickKind[];
  pages?: SitePage[];
  title?: string;
}

/** The picker itself (also used by the text toolbars to make a link). Escape closes, focus returns to the button. */
export function LinkPickerDialog({ open, value, onClose, onPick, kinds = PICK_KINDS, pages, title = 'Elegir a dónde lleva el enlace' }: LinkPickerDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth={600}>
      {open && <PickerBody value={value} onPick={onPick} onClose={onClose} kinds={kinds} given={pages} />}
    </Modal>
  );
}

function PickerBody({ value, onPick, onClose, kinds, given }: { value: string; onPick: (h: string) => void; onClose: () => void; kinds: PickKind[]; given?: SitePage[] }) {
  // The page list loads only once a picker opens.
  const fallback = useSitePages();
  const pages = given ?? fallback;
  const current = hrefKind(value);
  const [kind, setKind] = useState<PickKind>(current === 'empty' || current === 'invalid' ? (current === 'invalid' ? 'web' : 'page') : current);
  const uid = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const onTabsKey = (e: KeyboardEvent) => {
    const i = kinds.indexOf(kind);
    const next = e.key === 'ArrowRight' ? kinds[(i + 1) % kinds.length] : e.key === 'ArrowLeft' ? kinds[(i - 1 + kinds.length) % kinds.length] : e.key === 'Home' ? kinds[0] : e.key === 'End' ? kinds[kinds.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    setKind(next);
    tabsRef.current?.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus();
  };
  return (
    <div className="space-y-4">
      <div ref={tabsRef} role="tablist" tabIndex={-1} aria-label="Tipo de destino" className="flex flex-wrap gap-1.5" onKeyDown={onTabsKey}>
        {kinds.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button
              key={k}
              type="button"
              role="tab"
              data-kind={k}
              id={`${uid}-tab-${k}`}
              aria-selected={kind === k}
              aria-controls={`${uid}-panel`}
              tabIndex={kind === k ? 0 : -1}
              onClick={() => setKind(k)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border px-3 text-sm font-semibold ${kind === k ? 'border-purple bg-purple text-white' : 'border-line bg-white text-ink hover:border-purple/50'}`}
            >
              <Icon size={15} aria-hidden="true" /> {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${kind}`}>
        {kind === 'page' ? <PagesPanel value={value} pages={pages} onPick={onPick} /> : <ManualPanel key={kind} kind={kind} value={current === kind ? value : ''} onPick={onPick} />}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
        {value ? <Button type="button" variant="ghost" size="sm" onClick={() => onPick('')}>Quitar enlace</Button> : <span />}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
      </div>
    </div>
  );
}

function PagesPanel({ value, pages, onPick }: { value: string; pages: SitePage[]; onPick: (h: string) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const shown = pages.filter((p) => !needle || norm(`${p.title} ${p.path}`).includes(needle));
  const groups = Array.from(new Set(shown.map((p) => p.group)));
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input className="input-field pl-9" placeholder="Buscar página…" aria-label="Buscar página del sitio" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
        {groups.length === 0 && <p className="py-4 text-center text-sm text-muted">Ninguna página coincide con la búsqueda.</p>}
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-subtle">{g}</h3>
            <ul className="space-y-1">
              {shown.filter((p) => p.group === g).map((p) => (
                <li key={p.path}>
                  <PageOption title={p.title} detail={p.note ? `${p.path} · borrador` : p.path} selected={value === p.path} onClick={() => onPick(p.path)} />
                  {(SITE_ANCHORS[p.path] ?? []).map((a) => {
                    const href = `${p.path}#${a.hash}`;
                    return <PageOption key={a.hash} sub title={`Sección: ${a.title}`} detail={href} selected={value === href} onClick={() => onPick(href)} />;
                  })}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function PageOption({ title, detail, selected, onClick, sub }: { title: string; detail: string; selected: boolean; onClick: () => void; sub?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-[44px] w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left ${sub ? 'pl-8' : ''} ${selected ? 'bg-purple/10 ring-1 ring-purple' : 'hover:bg-cream-2'}`}
    >
      {sub && <CornerDownRight size={14} className="shrink-0 text-subtle" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        <span className="block truncate text-xs text-subtle">{detail}</span>
      </span>
    </button>
  );
}

function ManualPanel({ kind, value, onPick }: { kind: Exclude<PickKind, 'page'>; value: string; onPick: (h: string) => void }) {
  const wa = kind === 'whatsapp' ? parseWhatsApp(value) : { number: '', message: '' };
  const initial = kind === 'web' ? value : kind === 'email' ? value.replace(/^mailto:/, '') : kind === 'phone' ? value.replace(/^tel:/, '') : wa.number;
  const [main, setMain] = useState(initial);
  const [message, setMessage] = useState(wa.message);
  const [error, setError] = useState('');
  const uid = useId();
  const build = () => (kind === 'web' ? buildWeb(main) : kind === 'email' ? buildEmail(main) : kind === 'phone' ? buildPhone(main) : buildWhatsApp(main, message));
  const submit = () => {
    const href = build();
    if (!href) { setError('Escriba el dato para continuar.'); return; }
    const problem = hrefProblem(href) ?? (kind === 'whatsapp' && href.replace(/\D/g, '').length < 11 ? 'Revise el número: escriba los 10 dígitos.' : null);
    if (problem) { setError(problem); return; }
    onPick(href);
  };
  const text = {
    web: { label: 'Dirección del sitio', placeholder: 'https://classroom.google.com', hint: 'Copie la dirección de la barra del navegador. Se abre en una pestaña nueva.', type: 'url' as const },
    email: { label: 'Correo electrónico', placeholder: 'informes@interlaken.mx', hint: 'Al hacer clic se abre el programa de correo de la persona.', type: 'email' as const },
    phone: { label: 'Teléfono', placeholder: '55 5379 1188', hint: 'Diez dígitos. En el celular, el enlace llama directamente.', type: 'text' as const },
    whatsapp: { label: 'Número de WhatsApp', placeholder: '55 1234 5678', hint: 'Diez dígitos; se agrega el código de México.', type: 'text' as const },
  }[kind];
  const preview = build();
  return (
    // Not a <form>: the dialog renders inside the page's own forms (Navegación); Enter in the main field submits.
    <div className="space-y-3">
      <TextField id={`${uid}-main`} label={text.label} value={main} onChange={(v) => { setMain(v); setError(''); }} placeholder={text.placeholder} hint={text.hint} error={error || undefined} type={text.type} tokens={false} onEnter={submit} />
      {kind === 'whatsapp' && (
        <TextField id={`${uid}-msg`} label="Mensaje que aparece ya escrito (opcional)" value={message} onChange={setMessage} multiline rows={2} tokens={false} hint="Por ejemplo: «Hola, quiero informes de admisiones»." />
      )}
      {preview && !error && (
        <p className="flex items-center gap-1.5 break-all text-xs text-subtle"><ExternalLink size={12} aria-hidden="true" className="shrink-0" /> {preview}</p>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={submit}>Usar este destino</Button>
      </div>
    </div>
  );
}

export interface LinkValue { label?: string; href?: string }

export interface LinkFieldProps extends Omit<FieldBaseProps, 'id'> {
  /** Field id prefix: the text input is `${id}-label`, the destination button `${id}`. */
  id: string;
  value: LinkValue | undefined;
  onChange: (v: LinkValue) => void;
  /** Label of the text input (default «Texto del botón»). */
  textLabel?: string;
}

/** A button or link prop `{ label, href }`: its text (with data chips) and its destination. */
export function LinkField({ id, label, required, hint, error, warning, onBlur, value, onChange, textLabel = 'Texto del botón' }: LinkFieldProps) {
  const v = value ?? {};
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border border-line p-3" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{label}{required && <span aria-hidden="true" className="text-coral-600"> *</span>}</legend>
      <TextField id={`${id}-label`} label={textLabel} value={v.label ?? ''} onChange={(t) => onChange({ ...v, label: t })} onBlur={onBlur} warning={warning} />
      <HrefInput id={id} label="Destino" value={v.href ?? ''} onChange={(href) => onChange({ ...v, href })} error={error} onBlur={onBlur} required={required} />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
