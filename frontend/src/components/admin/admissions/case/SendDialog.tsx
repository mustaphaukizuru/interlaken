import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, Mail, MessageCircle, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/admin/CopyButton';
import { apiErrorCode, apiErrorMessage, apiFieldErrors } from '@/lib/apiErrors';
import { fmtDay, fmtDayTime } from '@/lib/caseStages';
import { casesApi, useCaseSideWrite, type CaseAction, type CaseDetail, type SendResult } from '@/hooks/queries/cases';

type Channel = 'email' | 'whatsapp' | 'copy';

interface ActionCopy {
  title: string;
  intro: string;
  /** The action shares a link (copy offers «Copiar liga»); else the message is copied. */
  hasLink: boolean;
  lastSent: (c: CaseDetail) => string | null;
}

export const ACTION_COPY: Record<CaseAction, ActionCopy> = {
  'send-costs': {
    title: 'Enviar cuotas',
    intro: 'Las cuotas del nivel en PDF. Por correo van adjuntas; por WhatsApp o copiadas, como liga.',
    hasLink: true,
    lastSent: (c) => c.informes.costs_sent_at,
  },
  'send-visit-link': {
    title: 'Enviar liga de visita',
    intro: 'Una liga personal para que la familia elija el día de su visita guiada. La visita que agende se suma a este expediente.',
    hasLink: true,
    lastSent: (c) => c.informes.visit_link_sent_at,
  },
  'send-ficha-link': {
    title: 'Enviar ficha de inscripción',
    intro: 'Una liga personal para llenar la ficha de inscripción en línea. Cada envío genera una liga nueva y la anterior deja de servir.',
    hasLink: true,
    lastSent: (c) => c.ficha_link.sent_at,
  },
  'send-exam-date': {
    title: 'Enviar fecha del examen',
    intro: 'El día y la hora del examen de admisión, con la fecha de entrega de resultados si ya la tiene.',
    hasLink: false,
    lastSent: (c) => c.examen.date_sent_at,
  },
  'send-exam-result': {
    title: 'Enviar resultado del examen',
    intro: 'El resultado que registró en el expediente, con el texto de la plantilla correspondiente.',
    hasLink: false,
    lastSent: (c) => c.examen.result_sent_at,
  },
};

const OPTION = 'flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition focus-within:ring-2 focus-within:ring-purple/40';

/** Opens a tab inside the click (iPad Safari blocks a window opened after an await). */
function openBlankTab(): Window | null {
  try { return window.open('about:blank', '_blank'); } catch { return null; }
}

function sendTo(win: Window | null, url: string) {
  if (win && !win.closed) {
    try { win.opener = null; } catch { /* cross-origin once navigated */ }
    win.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * «Enviar…» for every Expediente action: by email (the school's branded
 * message, the costs PDF attached), by WhatsApp (the text ready in a new tab)
 * or copying the link or the text to paste anywhere. Shows when it was last
 * sent and, for the ficha before the exam is scheduled, the administrator's
 * override (audited by the server).
 */
export function SendDialog({ open, onClose, action, detail, isAdmin }: {
  open: boolean;
  onClose: () => void;
  action: CaseAction | null;
  detail: CaseDetail;
  isAdmin: boolean;
}) {
  const title = action ? ACTION_COPY[action].title : '';
  return (
    <Modal open={open && !!action} onClose={onClose} title={title} maxWidth={520}>
      {action && <SendBody key={action} action={action} detail={detail} isAdmin={isAdmin} onClose={onClose} />}
    </Modal>
  );
}

function SendBody({ action, detail, isAdmin, onClose }: { action: CaseAction; detail: CaseDetail; isAdmin: boolean; onClose: () => void }) {
  const copy = ACTION_COPY[action];
  const hasEmail = !!detail.parent_email;
  const [channel, setChannel] = useState<Channel>(hasEmail ? 'email' : 'whatsapp');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [result, setResult] = useState<(SendResult & { requested: Channel; copied?: boolean }) | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const send = useCaseSideWrite(detail.id, (vars: { channel: 'email' | 'whatsapp'; override?: boolean }) =>
    casesApi.action(detail.id, action, vars).then((r) => r.data));

  // The ficha before «Examen agendado»: refused unless an administrator
  // overrides it. The server has the last word: a 409 «too_early» (the page
  // was stale) opens the same override.
  const fichaGate = action === 'send-ficha-link' ? detail.ficha_link : null;
  const tooEarly = error?.code === 'too_early';
  const blocked = (!!fichaGate && !fichaGate.allowed) || tooEarly;
  const refused = !!fichaGate && !fichaGate.allowed && !fichaGate.overridable;
  const canOverride = blocked && !refused && isAdmin && (tooEarly || !!fichaGate?.can_override);
  const needsOverride = blocked && !override;

  useEffect(() => {
    if (result) doneRef.current?.focus();
  }, [result]);

  const submit = async () => {
    setError(null);
    const win = channel === 'whatsapp' ? openBlankTab() : null;
    try {
      const res = await send.mutateAsync({ channel: channel === 'email' ? 'email' : 'whatsapp', ...(override ? { override: true } : {}) });
      let copied: boolean | undefined;
      if (channel === 'email') {
        if (res.sent) toast.success(`Enviado por correo a ${res.sent_to}.`);
        else toast.error('El correo no salió. Envíe el mensaje por WhatsApp.');
      } else if (channel === 'whatsapp') {
        if (res.whatsapp_url) sendTo(win, res.whatsapp_url);
        else {
          win?.close();
          toast.error('El expediente no tiene un celular de 10 dígitos. Copie el mensaje.');
        }
      } else {
        copied = await copyText(copy.hasLink && res.link ? res.link : res.whatsapp_text);
        if (copied) toast.success(copy.hasLink && res.link ? 'Liga copiada.' : 'Mensaje copiado.');
      }
      setResult({ ...res, requested: channel, copied });
    } catch (e) {
      win?.close();
      const code = apiErrorCode(e);
      const fields = apiFieldErrors(e);
      setError({ message: fields.channel || apiErrorMessage(e, 'No se pudo enviar.'), code });
    }
  };

  if (result) return <SendDone headingRef={doneRef} result={result} hasLink={copy.hasLink} onClose={onClose} />;

  const last = copy.lastSent(detail);
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <p className="text-sm text-muted">{copy.intro}</p>
      {last && <p className="text-xs text-subtle">Último envío: {fmtDayTime(last)}</p>}

      {fichaGate && (
        <div className={clsx('rounded-xl px-3 py-2.5 text-sm', blocked ? 'bg-amber/10 text-ink' : 'bg-cream text-muted')}>
          {blocked ? (
            <p className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
              <span>{fichaGate.reason || error?.message}</span>
            </p>
          ) : (
            <p>Cada liga nueva vence a los 14 días{detail.ficha?.invite_expires_at ? `; la que tiene la familia vence el ${fmtDay(detail.ficha.invite_expires_at)}` : ''}.</p>
          )}
          {blocked && canOverride && (
            <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 font-medium">
              <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
                checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Enviar de todos modos (administrador; queda en el historial)
            </label>
          )}
          {blocked && !canOverride && !refused && (
            <p className="mt-1 text-xs text-muted">Solo un administrador puede enviarla antes de agendar el examen.</p>
          )}
        </div>
      )}

      <fieldset>
        <legend className="label">¿Cómo la envía?</legend>
        <div className="grid gap-2">
          <ChannelOption value="email" current={channel} onPick={setChannel} disabled={!hasEmail} icon={Mail} title="Por correo"
            hint={hasEmail ? detail.parent_email : 'El expediente no tiene correo. Agréguelo en Informes.'} />
          <ChannelOption value="whatsapp" current={channel} onPick={setChannel} icon={MessageCircle} title="Por WhatsApp"
            hint={`Se abre WhatsApp con el mensaje listo${detail.parent_phone ? ` para ${detail.parent_phone}` : ''}.`} />
          <ChannelOption value="copy" current={channel} onPick={setChannel} icon={ClipboardCopy} title={copy.hasLink ? 'Copiar liga' : 'Copiar mensaje'}
            hint={copy.hasLink ? 'Para pegarla en otro medio. Se registra como enviada.' : 'Para pegarlo en otro medio. Se registra como enviado.'} />
        </div>
      </fieldset>

      {error && !tooEarly && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-coral-50 px-3 py-2.5 text-sm text-coral-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error.message}</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={send.isPending} disabled={refused || needsOverride}>
          {channel === 'email' ? 'Enviar por correo' : channel === 'whatsapp' ? 'Abrir WhatsApp' : copy.hasLink ? 'Copiar liga' : 'Copiar mensaje'}
        </Button>
      </div>
    </form>
  );
}

/** One way of sending, as a large tap target (radio inside its label). */
function ChannelOption({ value, current, onPick, disabled, icon: Icon, title, hint }: {
  value: Channel; current: Channel; onPick: (c: Channel) => void; disabled?: boolean;
  icon: typeof Mail; title: string; hint: string;
}) {
  const checked = current === value;
  return (
    <label className={clsx(OPTION, checked ? 'border-purple bg-purple/5' : 'border-line', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="radio" name="channel" value={value} className="mt-1" checked={checked} disabled={disabled} onChange={() => onPick(value)} />
      <span className="min-w-0 font-semibold text-ink">
        <Icon size={16} className="mr-1.5 inline align-[-3px]" aria-hidden="true" />{title}
        <span className="block break-words text-xs font-normal text-muted">{hint}</span>
      </span>
    </label>
  );
}

function SendDone({ headingRef, result, hasLink, onClose }: {
  headingRef: React.Ref<HTMLHeadingElement>;
  result: SendResult & { requested: Channel; copied?: boolean };
  hasLink: boolean;
  onClose: () => void;
}) {
  const emailed = result.requested === 'email' && result.sent;
  const emailFailed = result.requested === 'email' && !result.sent;
  const copyValue = hasLink && result.link ? result.link : result.whatsapp_text;
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <h4 ref={headingRef} tabIndex={-1} className={clsx('flex items-center gap-2 font-semibold focus:outline-none', emailFailed ? 'text-coral-700' : 'text-green-700')}>
        {emailFailed ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
        {emailed
          ? `Enviado por correo a ${result.sent_to}`
          : emailFailed
            ? 'El correo no salió'
            : result.requested === 'whatsapp'
              ? 'Mensaje listo en WhatsApp'
              : result.copied ? (hasLink ? 'Liga copiada' : 'Mensaje copiado') : 'Copie el texto'}
      </h4>
      {result.sent_at && <p className="text-xs text-subtle">Registrado como enviado el {fmtDayTime(result.sent_at)}.</p>}
      {emailFailed && <p className="text-sm text-muted">Revise el correo del expediente o envíe este mensaje por WhatsApp.</p>}
      {result.expires_at && <p className="text-sm text-muted">La liga vence el {fmtDay(result.expires_at)}.</p>}

      {!emailed && (
        <div className="space-y-2">
          <div className="relative">
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-cream-2 p-3 pr-10 font-sans text-sm text-ink">{result.whatsapp_text}</pre>
            <CopyButton value={result.whatsapp_text} label="el mensaje" className="absolute right-2 top-2" />
          </div>
          {hasLink && result.link && (
            <p className="flex items-center gap-1 break-all text-xs text-muted">
              <span className="min-w-0">{result.link}</span>
              <CopyButton value={result.link} label="la liga" />
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!emailed && result.whatsapp_url && (
          <a href={result.whatsapp_url} target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex min-h-[44px] items-center justify-center gap-2 text-sm">
            <MessageCircle size={16} aria-hidden="true" /> Abrir WhatsApp
          </a>
        )}
        {result.requested === 'copy' && !result.copied && (
          <Button type="button" variant="secondary" onClick={() => void copyText(copyValue).then((ok) => ok && toast.success('Copiado'))}>
            <ClipboardCopy size={16} aria-hidden="true" /> {hasLink ? 'Copiar liga' : 'Copiar mensaje'}
          </Button>
        )}
        <Button type="button" onClick={onClose}>Listo</Button>
      </div>
    </div>
  );
}

export default SendDialog;
