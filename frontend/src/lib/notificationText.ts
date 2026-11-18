/**
 * notificationText.ts — read a notification body as structure, not as a wall.
 *
 * Bodies are plain text composed by the backend (cron reports, alerts, page
 * reviews). This only decides how to SHOW them; it never changes the text:
 *
 *   - a blank line separates paragraphs; single line breaks stay line breaks;
 *   - lines starting with "- ", "• " or "* " are list items;
 *   - short "Etiqueta: valor" lines (in a body of more than one line) are
 *     label/value rows;
 *   - list items written as "Nombre · dato · dato" keep the first part as the
 *     item and the rest as its details; an ALL-CAPS detail ("VENCIDA",
 *     "SIN VERIFICAR: ...") is a flag worth a badge.
 */

export type MessageBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'fields'; rows: { label: string; value: string }[] };

const BULLET = /^\s*[-•*]\s+(.*\S)\s*$/;
const FIELD = /^([^:]{1,32}):\s+(\S.{0,119})$/;
const LABEL_STOP = /[.,;!?()«»"“”/]/;

function fieldOf(line: string): { label: string; value: string } | null {
  const m = FIELD.exec(line.trim());
  if (!m) return null;
  const label = m[1].trim();
  if (LABEL_STOP.test(label) || label.split(/\s+/).length > 4) return null;
  // A label starts like a label: capitalised, not mid-sentence.
  if (label[0] !== label[0].toLocaleUpperCase('es-MX')) return null;
  return { label, value: m[2].trim() };
}

export function parseMessage(text: string | null | undefined): MessageBlock[] {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').trim().split('\n');
  const multiline = lines.filter((l) => l.trim()).length > 1;
  const blocks: MessageBlock[] = [];
  let current: MessageBlock | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (current?.kind !== 'list') { flush(); current = { kind: 'list', items: [] }; }
      current.items.push(bullet[1]);
      continue;
    }
    const field = multiline ? fieldOf(line) : null;
    if (field) {
      if (current?.kind !== 'fields') { flush(); current = { kind: 'fields', rows: [] }; }
      current.rows.push(field);
      continue;
    }
    if (current?.kind !== 'paragraph') { flush(); current = { kind: 'paragraph', lines: [] }; }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

/**
 * One or two lines for the bell and the list: the opening paragraph, list
 * markers dropped, whitespace collapsed. An opening that introduces a list
 * ("...(total $550.00):") ends in an ellipsis instead of the colon.
 */
export function notifPreview(text: string | null | undefined, max = 220): string {
  const [first, next] = parseMessage(text);
  if (!first) return '';
  let out =
    first.kind === 'paragraph' ? first.lines.join(' ')
      : first.kind === 'list' ? first.items.join(' · ')
        : first.rows.map((r) => `${r.label}: ${r.value}`).join(' · ');
  out = out.replace(/\s+/g, ' ').trim();
  if (next && /:$/.test(out)) out = `${out.slice(0, -1).trimEnd()}…`;
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

export interface ListItemParts {
  main: string;
  details: { text: string; flag?: string }[];
}

const FLAG = /^([A-ZÁÉÍÓÚÑÜ]{3,}(?: [A-ZÁÉÍÓÚÑÜ]{2,})*)(?::\s*(.*))?$/;

/** "Ana López · cliente C-1 · $350.00 · VENCIDA" → main + details (flags marked). */
export function listItemParts(item: string): ListItemParts {
  const parts = item.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { main: item, details: [] };
  return {
    main: parts[0],
    details: parts.slice(1).map((p) => {
      const m = FLAG.exec(p);
      return m ? { flag: m[1], text: m[2] ?? '' } : { text: p };
    }),
  };
}

export type TextToken = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const LINK = /(https?:\/\/[^\s<>«»"]+|www\.[^\s<>«»"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
const TRAILING = /[.,;:!?»”)]+$/;

/** Plain text with its URLs and e-mail addresses as links (trailing punctuation stays text). */
export function linkify(text: string): TextToken[] {
  const out: TextToken[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    let raw = m[0];
    let tail = '';
    const t = TRAILING.exec(raw);
    if (t) {
      // Keep a ")" that closes a "(" inside the URL itself.
      let cut = t[0];
      if (cut.startsWith(')') && raw.slice(0, -cut.length).includes('(')) cut = cut.slice(1);
      if (cut) { tail = cut; raw = raw.slice(0, -cut.length); }
    }
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    const href = raw.includes('@') && !/^https?:/.test(raw) && !raw.startsWith('www.')
      ? `mailto:${raw}`
      : raw.startsWith('www.') ? `https://${raw}` : raw;
    out.push({ kind: 'link', text: raw, href });
    if (tail) out.push({ kind: 'text', text: tail });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
