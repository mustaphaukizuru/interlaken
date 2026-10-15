/**
 * Banorte "Ventana de Comercio Electrónico" lightbox (manual v1.7, Anexo A).
 *
 * Banorte requires its scripts to load from its own server (never a local
 * copy): jQuery 3.3.1 first, then checkoutV2.js, which finds its own <script>
 * tag to learn its base URL. `Payment.setEnv()` then loads the modal plugin
 * and crypto helpers ASYNCHRONOUSLY while `startPayment()` calls `.modal()`
 * 250 ms later — fine on office Wi-Fi, a race on a phone. So we wait for the
 * modal plugin before starting.
 *
 * The card, 3D Secure and the charge happen inside Banorte's iframe. Its
 * callbacks only reach the browser; we forward each one to the backend, which
 * decrypts the result with a key the browser never sees.
 */

export type BanorteEvent = 'success' | 'error' | 'cancel' | 'closed';

interface BanortePayment {
  setEnv: (env: string) => void;
  startPayment: (config: {
    Params: string;
    onSuccess: (r: unknown) => void;
    onError: (r: unknown) => void;
    onCancel: (r: unknown) => void;
    onClosed: (r: unknown) => void;
  }) => void;
}

type BanorteWindow = Window & {
  /** Set by public/banorte-bridge.js (checkoutV2.js's `let Payment` is not on window). */
  __banortePayment?: BanortePayment;
  jQuery?: { fn?: { modal?: unknown }; modal?: { close?: () => void } };
};

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const cached = loaded.get(src);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false; // preserve order: jQuery before checkoutV2.js
    el.onload = () => resolve();
    el.onerror = () => {
      loaded.delete(src);
      el.remove();
      reject(new Error(`No se pudo cargar ${src}`));
    };
    document.head.appendChild(el);
  });
  loaded.set(src, promise);
  return promise;
}

function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('La ventana de pago de Banorte no respondió.'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

let envReady: string | null = null;

/** Load Banorte's scripts once and select the environment. */
export async function prepareBanorte(start: { script_url: string; jquery_url: string; env: string }) {
  const w = window as BanorteWindow;
  await loadScript(start.jquery_url);
  await loadScript(start.script_url);
  await loadScript(`${import.meta.env.BASE_URL}banorte-bridge.js`);
  const payment = w.__banortePayment;
  if (!payment) throw new Error('La ventana de pago de Banorte no está disponible.');
  if (envReady !== start.env) {
    payment.setEnv(start.env);
    envReady = start.env;
  }
  await waitFor(() => typeof w.jQuery?.fn?.modal === 'function', 15000);
  return payment;
}

// checkoutV2.js never removes its window "message" listener after a success,
// so a second checkout in the same page would also fire the first one's
// callbacks. Only the newest session's callbacks are honoured.
let activeSession = 0;

/**
 * Open the lightbox. `onEvent` receives every Banorte callback (of this
 * session only) with its raw response.
 */
export async function openBanorteLightbox(
  start: { params: string; script_url: string; jquery_url: string; env: string },
  onEvent: (event: BanorteEvent, response: unknown) => void,
) {
  const payment = await prepareBanorte(start);
  const session = ++activeSession;
  const forward = (event: BanorteEvent) => (r: unknown) => {
    if (session === activeSession) onEvent(event, r ?? {});
  };
  payment.startPayment({
    Params: start.params,
    onSuccess: forward('success'),
    onError: forward('error'),
    onCancel: forward('cancel'),
    onClosed: forward('closed'),
  });
}

/**
 * Close the lightbox and undo its page lock. checkoutV2.js closes itself on
 * cancel/close, but after a success it leaves the modal open and the page
 * scroll-locked (html.BanPaymentHostLocked + body position:fixed).
 */
export function closeBanorteLightbox() {
  activeSession += 1;
  const w = window as BanorteWindow;
  try {
    w.jQuery?.modal?.close?.();
  } catch {
    /* already closed */
  }
  document.documentElement.classList.remove('BanPaymentHostLocked');
  document.body.style.top = '';
}
