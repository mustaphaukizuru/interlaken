import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { Camera, Maximize2, Repeat2, ScanLine, SquareUserRound, Sun, SunMedium, Trash2, X } from 'lucide-react';
import { Barcode } from '@/components/ui/Barcode';
import { Badge } from '@/components/ui/Badge';
import { CredentialFace, NoPhoto } from '@/components/portal/CredentialFace';
import { CredentialBack } from '@/components/portal/CredentialBack';
import { photoSrc, validityLong, validUntil } from '@/lib/credential';
import { apiErrorMessage } from '@/lib/apiErrors';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaCard } from '@/types';
import { BalanceWithPending, PendingProjectionNote } from '@/components/portal/BalanceWithPending';

export interface Sibling { id: number; name: string }

/** Keeps the screen on while the cashier scans (Screen Wake Lock); true while it holds. */
function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (gone) { void next.release(); return; }
        lock = next;
        setHeld(true);
        next.addEventListener('release', () => setHeld(false));
      } catch { setHeld(false); }
    };
    void acquire();
    // The browser drops the lock when the tab is hidden: take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible' && (!lock || lock.released)) void acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
  return active && held;
}

const MAX_PHOTO = 5 * 1024 * 1024;
const uploadedPhoto = (url?: string) => !!url && url.startsWith('/api/v1/accounts/avatar/');

/**
 * Digital cafetería card: the student's phone becomes their POS card. The
 * card is drawn as the school's printed student ID (CredentialFace, with the
 * Loyverse code as its Matrícula and Code128 barcode, what the register
 * reads); a tap turns it over (CredentialBack). The live balance sits in the
 * panel beside it. «Mostrar en pantalla completa» opens the counter view: big
 * barcode + QR on white, the photo to check who pays, and the screen kept on.
 * With brothers and sisters (`siblings`), a swipe on the card moves between
 * their cards (`onPick`). `footer` goes under the balance.
 */
export default function StudentCard({ card, footer, siblings = [], onPick }: {
  card: CafeteriaCard;
  footer?: ReactNode;
  siblings?: Sibling[];
  onPick?: (id: number) => void;
}) {
  const [full, setFull] = useState(false);
  const s = card.student;
  // A staff member's own account (tipo «personal») reads as its puesto, with
  // no grade or group: never «Alumno».
  const staff = s.tipo === 'personal';
  // The puesto once the office set one, else «Personal del colegio» (as the
  // account menu does; inline so lib/people stays out of the shared graph).
  const roleLine = staff
    ? (s.puesto && s.puesto !== 'sin_asignar' && s.puesto_label) || 'Personal del colegio'
    : [s.grade, s.group && `Grupo ${s.group}`].filter(Boolean).join(' · ');
  // «Saldo bajo» as on the cafetería page and the dashboard: not while paid
  // top-ups on their way reach the alert level (older APIs: the raw flag).
  const low = card.low_balance_alert ?? card.is_low_balance;
  const until = validityLong(validUntil());

  // Front or back, per child (another child's card opens on its front). The
  // back is drawn once it has been asked for, and stays for the turn back.
  const [flippedId, setFlippedId] = useState<number | null>(null);
  const [backId, setBackId] = useState<number | null>(null);
  const flipped = flippedId === s.id;
  const toggleFlip = () => {
    setBackId(s.id);
    setFlippedId((id) => (id === s.id ? null : s.id));
  };

  // Swipe between brothers' and sisters' cards; the new one slides in from that side.
  const index = siblings.findIndex((x) => x.id === s.id);
  const [enter, setEnter] = useState<{ id: number; dir: 'next' | 'prev' } | null>(null);
  const pick = (id: number, dir: 'next' | 'prev') => {
    if (!onPick || id === s.id) return;
    setEnter({ id, dir });
    onPick(id);
  };
  const step = (dir: 'next' | 'prev') => {
    if (siblings.length < 2 || index < 0) return;
    const n = siblings.length;
    pick(siblings[(index + (dir === 'next' ? 1 : n - 1)) % n].id, dir);
  };
  // Pointer gestures on the card: a tap turns it over, a sideways swipe changes child.
  const flipRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({ step, toggleFlip });
  useEffect(() => { gesture.current = { step, toggleFlip }; });
  useEffect(() => {
    const el = flipRef.current;
    if (!el) return undefined;
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: PointerEvent) => { if (e.button === 0) start = { x: e.clientX, y: e.clientY, t: Date.now() }; };
    const up = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const quick = Date.now() - start.t < 700;
      start = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) gesture.current.step(dx < 0 ? 'next' : 'prev');
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && quick) gesture.current.toggleFlip();
    };
    const cancel = () => { start = null; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, []);

  // «Subir foto» (only while the school allows it, own children only).
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const photo = useMutation({
    mutationFn: (file: File | null) => (file ? cafeteriaApi.uploadCardPhoto(s.id, file) : cafeteriaApi.removeCardPhoto(s.id)),
    onSuccess: (_r, file) => {
      void qc.invalidateQueries({ queryKey: ['cafeteria-cards'] });
      toast.success(file ? 'Foto guardada. Así aparece en la credencial.' : 'Foto quitada.');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo guardar la foto. Intente con otra imagen.')),
  });
  const onFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Elija una imagen (JPG, PNG o WebP).'); return; }
    if (file.size > MAX_PHOTO) { toast.error('La imagen supera 5 MB.'); return; }
    photo.mutate(file);
  };

  // Focus management for the full-screen view (same pattern as Modal): move
  // focus to the close button on open, restore it to the opener on close.
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const awake = useWakeLock(full);
  const swipeY = useRef<number | null>(null);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const fullPhoto = s.photo && failedPhoto !== s.photo ? photoSrc(s.photo) : '';

  // Escape closes the full-screen scan view; body scroll is locked while open.
  useEffect(() => {
    if (!full) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFull(false); return; }
      // Trap Tab inside the overlay: it declares aria-modal, but focus could
      // still walk into the portal behind it, where a screen-reader user has no
      // way of knowing the card is covering the page.
      if (e.key !== 'Tab' || !overlayRef.current) return;
      const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [full]);

  const animate = enter && enter.id === s.id ? (enter.dir === 'next' ? 'cred-in-next' : 'cred-in-prev') : '';

  return (
    <>
      {/* The card as printed, with the wallet beside it (under it on phones).
          The card itself stays the printed one: the balance lives in the panel. */}
      <div
        data-testid="credencial-face"
        className="mx-auto grid w-full max-w-4xl items-start gap-5 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:gap-6 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:gap-8 print:block"
      >
        <div className="mx-auto w-full max-w-[28rem] md:max-w-none print:mx-0 print:w-[85.6mm]">
          <div ref={flipRef} className="cred-flip cursor-pointer select-none" data-flipped={flipped ? 'true' : 'false'}>
            <div key={s.id} className={`cred-flip-inner ${animate}`}>
              <div className="cred-side" aria-hidden={flipped || undefined}>
                <CredentialFace card={card} className="w-full" />
              </div>
              {backId === s.id && (
                <div className="cred-side cred-side-back" aria-hidden={!flipped || undefined}>
                  <CredentialBack card={card} className="w-full" />
                </div>
              )}
            </div>
          </div>

          {siblings.length > 1 && (
            <div className="mt-2 flex items-center justify-center gap-1 print:hidden" role="group" aria-label="Credenciales de la familia">
              {siblings.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => pick(x.id, i > index ? 'next' : 'prev')}
                  aria-label={`Ver credencial de ${x.name.split(' ')[0]}`}
                  aria-current={x.id === s.id ? 'true' : undefined}
                  className="group flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                >
                  <span className={`block h-2.5 rounded-full transition-all motion-reduce:transition-none ${x.id === s.id ? 'w-6 bg-purple' : 'w-2.5 bg-ink/20 group-hover:bg-ink/40'}`} />
                </button>
              ))}
              <span className="sr-only md:hidden">Deslice la credencial para ver la de sus hermanos.</span>
            </div>
          )}

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 print:hidden">
            {card.code ? (
              // 48 px: students use this view (Phase 6).
              <button type="button" onClick={() => setFull(true)} className="btn-primary min-h-[48px] text-sm">
                <Maximize2 size={18} aria-hidden="true" /> Mostrar en pantalla completa
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={toggleFlip}
              className="btn-secondary min-h-[48px] px-4 text-sm"
            >
              <Repeat2 size={18} aria-hidden="true" /> {flipped ? 'Ver frente' : 'Ver reverso'}
            </button>
          </div>
        </div>

        <div className="rounded-md bg-white p-5 shadow-card print:hidden">
          <div className="flex items-start justify-between gap-3">
            <BalanceWithPending
              className="min-w-0"
              balance={card.balance}
              pending={card.pending_topups}
              low={low}
              note={false}
            />
            {low && <Badge variant="warning">Saldo bajo</Badge>}
          </div>
          <PendingProjectionNote
            balance={card.balance}
            pending={card.pending_topups}
            className="mt-1 text-sm leading-snug text-muted"
          />
          {footer && <div className="mt-3">{footer}</div>}
          {!card.code && (
            <p className="mt-3 text-sm text-muted">
              {staff
                ? 'Esta cuenta aún no tiene cafetería. Contacte al colegio para activarla.'
                : 'Este alumno aún no tiene cafetería. Contacte al colegio para activarla.'}
            </p>
          )}
          <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-[13px] leading-snug text-muted">
            <li className="flex gap-2">
              <ScanLine size={16} className="mt-px flex-shrink-0 text-subtle" aria-hidden="true" />
              <span>En caja escanean el código de barras de la credencial: con «Pantalla completa» se lee mejor.</span>
            </li>
            {card.can_upload_photo ? (
              <li className="flex flex-col gap-2">
                <span className="flex gap-2">
                  <SquareUserRound size={16} className="mt-px flex-shrink-0 text-subtle" aria-hidden="true" />
                  <span>{s.photo ? 'Puede cambiar la foto de la credencial.' : 'Agregue una foto para que en caja reconozcan al alumno.'} Use una foto reciente, de frente y sin otras personas.</span>
                </span>
                <span className="flex flex-wrap gap-2 pl-6">
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1}
                    aria-hidden="true" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={photo.isPending}
                    className="btn-secondary min-h-[44px] px-3 py-2 text-sm">
                    <Camera size={16} aria-hidden="true" /> {photo.isPending ? 'Guardando…' : s.photo ? 'Cambiar foto' : 'Subir foto'}
                  </button>
                  {uploadedPhoto(s.photo) && (
                    <button type="button" onClick={() => photo.mutate(null)} disabled={photo.isPending}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-muted hover:bg-cream hover:text-ink disabled:opacity-50">
                      <Trash2 size={16} aria-hidden="true" /> Quitar foto
                    </button>
                  )}
                </span>
              </li>
            ) : !s.photo && (
              <li className="flex gap-2">
                <SquareUserRound size={16} className="mt-px flex-shrink-0 text-subtle" aria-hidden="true" />
                <span>{staff
                  ? 'Sin foto todavía: aparecerá la de su cuenta de Google cuando inicie sesión con ella.'
                  : 'Sin foto todavía: aparecerá la de la cuenta de Google del alumno cuando inicie sesión con ella.'}</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Counter view: big, bright, scan-ready. Tap anywhere or swipe down to close. */}
      {full && card.code && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-overlay flex flex-col items-center justify-center gap-5 bg-white p-[max(1.5rem,env(safe-area-inset-bottom))] print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Código para escanear en caja"
          onPointerDown={(e) => { swipeY.current = e.clientY; }}
          onPointerUp={(e) => {
            const startY = swipeY.current;
            swipeY.current = null;
            if (startY != null && e.clientY - startY > 80) setFull(false);
          }}
        >
          {/* Full-size backdrop: tap anywhere to close (a real button = keyboard-accessible). */}
          <button
            type="button"
            onClick={() => setFull(false)}
            aria-label="Cerrar código"
            className="absolute inset-0 cursor-default"
          />
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => setFull(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 z-10 flex h-12 w-12 items-center justify-center rounded-sm text-muted transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
          >
            <X size={24} aria-hidden="true" />
          </button>
          <span className="pointer-events-none absolute left-1/2 top-3 h-1.5 w-12 -translate-x-1/2 rounded-full bg-ink/15" aria-hidden="true" />

          <div className="pointer-events-none relative z-10 flex items-center gap-4">
            <div className="h-20 w-[3.75rem] flex-shrink-0 overflow-hidden rounded-sm bg-cream ring-1 ring-line">
              {fullPhoto
                ? <img src={fullPhoto} alt="" referrerPolicy="no-referrer" onError={() => setFailedPhoto(s.photo ?? null)} className="h-full w-full object-cover" />
                : <NoPhoto />}
            </div>
            <div className="min-w-0 text-left">
              <p className="font-head text-xl font-bold leading-tight text-ink">{s.name}</p>
              <p className="text-sm text-muted">{roleLine}</p>
              <p className="text-xs text-subtle">Vigente al {until}</p>
            </div>
          </div>

          <Barcode value={card.code} height={150} fontSize={24} className="pointer-events-none relative z-10 w-full max-w-lg" />
          <div className="pointer-events-none relative z-10"><QRCodeSVG value={card.code} size={176} level="M" marginSize={2} /></div>

          <p className="pointer-events-none relative z-10 flex max-w-sm items-start gap-2 text-left text-sm text-muted" aria-live="polite">
            {awake
              ? <><SunMedium size={20} className="flex-shrink-0" aria-hidden="true" /> <span>La pantalla se mantiene encendida. Suba el brillo para leerlo mejor.</span></>
              : <><Sun size={20} className="flex-shrink-0" aria-hidden="true" /> <span>Suba el brillo y muestre este código en caja.</span></>}
          </p>
        </div>
      )}
    </>
  );
}
