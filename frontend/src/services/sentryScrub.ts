/**
 * sentryScrub.ts: what may leave the browser with a Sentry event.
 *
 * Pure functions with no @sentry import, so they are unit-tested without the
 * SDK; services/sentry.ts wires them in as beforeSend / beforeBreadcrumb (and
 * that module only loads when VITE_SENTRY_DSN is set at build time). Rules:
 *
 * - the user is reduced to its opaque id (never email, name, username or IP);
 * - URLs lose their query string and fragment (password-reset and invitation
 *   tokens, OAuth codes), in the request, the Referer and every breadcrumb;
 * - request bodies and cookies are dropped, secret-looking headers filtered;
 * - email addresses and CURPs are masked in messages, exception values,
 *   breadcrumbs and extras; console breadcrumbs keep the message only.
 */

export const FILTERED = '[Filtered]';

const SENSITIVE_HEADERS = ['token', 'password', 'secret', 'authorization', 'credential', 'curp', 'cookie'];
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Mexican CURP: 4 letters, birth date, sex, state, 3 consonants, 2 check chars.
const CURP = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z\d]\d\b/g;
const MAX_DEPTH = 10;

export interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScrubbableEvent {
  message?: string;
  transaction?: string;
  user?: { id?: string | number; [key: string]: unknown };
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
}

export function maskText(text: string): string {
  return text.replace(EMAIL, '[email]').replace(CURP, '[CURP]');
}

/** ``url`` without its query string and fragment (relative URLs stay relative). */
export function stripUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function maskDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskText(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = maskDeep(item, depth + 1);
  }
  return out;
}

function scrubBreadcrumbInPlace(crumb: ScrubbableBreadcrumb): void {
  if (typeof crumb.message === 'string') crumb.message = maskText(crumb.message);
  const data = crumb.data;
  if (!data) return;
  if (crumb.category === 'console') {
    // console.* arguments can be whole objects (a form's values): keep the text only.
    delete data.arguments;
  }
  for (const key of ['url', 'from', 'to']) {
    const value = data[key];
    if (typeof value === 'string') data[key] = stripUrl(value);
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') data[key] = maskText(value);
  }
}

export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(crumb: T): T {
  scrubBreadcrumbInPlace(crumb);
  return crumb;
}

function scrubEventInPlace(event: ScrubbableEvent): void {
  if (event.user) {
    event.user = event.user.id !== undefined ? { id: event.user.id } : undefined;
  }
  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    if (request.query_string) request.query_string = FILTERED;
    if (typeof request.url === 'string') request.url = stripUrl(request.url);
    const headers = request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        const lowered = key.toLowerCase();
        if (SENSITIVE_HEADERS.some((s) => lowered.includes(s))) headers[key] = FILTERED;
        else if (lowered === 'referer') headers[key] = stripUrl(headers[key]);
      }
    }
  }
  if (typeof event.message === 'string') event.message = maskText(event.message);
  if (typeof event.transaction === 'string') event.transaction = stripUrl(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === 'string') exception.value = maskText(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumbInPlace(crumb);
  if (event.extra) event.extra = maskDeep(event.extra) as Record<string, unknown>;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  scrubEventInPlace(event);
  return event;
}
