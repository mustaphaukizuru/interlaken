/**
 * The privacy notice is stored as plain text (PrivacyNoticeVersion.body):
 * paragraphs separated by a blank line, and each part of the notice opens
 * with a heading paragraph written in capitals. The public page
 * (cms/sections/aviso) shows the text before the first heading as the intro
 * and every heading as a collapsible part; with fewer than three parts it
 * shows the whole text as is.
 *
 * The console editor («Aviso de privacidad») works on the same structure:
 * an intro plus a list of parts (title + text), written back in exactly the
 * format the page reads.
 */

export interface NoticeSection {
  title: string;
  paragraphs: string[];
}

/** A heading paragraph: at least 15 letters, more than 90 % of them capitals. */
export function isNoticeHeading(p: string): boolean {
  const letters = p.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letters.length < 15) return false;
  const upper = letters.replace(/[a-záéíóúüñ]/g, '');
  return upper.length / letters.length > 0.9;
}

/**
 * Divide el texto oficial en secciones legibles usando sus propios
 * encabezados (párrafos en mayúsculas). El texto legal NO se altera:
 * solo se presenta por secciones; si la estructura no se reconoce,
 * se muestra íntegro tal cual (fallback).
 */
export function parseNotice(body: string): { intro: string[]; sections: NoticeSection[] } {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const intro: string[] = [];
  const sections: NoticeSection[] = [];
  for (const p of paragraphs) {
    if (isNoticeHeading(p)) {
      sections.push({ title: p.replace(/\s*\n\s*/g, ' '), paragraphs: [] });
    } else if (sections.length === 0) {
      intro.push(p);
    } else {
      sections[sections.length - 1].paragraphs.push(p);
    }
  }
  return { intro, sections };
}

/** The page shows the notice by parts only from this many parts on. */
export const MIN_PARTS = 3;

/** What the console edits: the intro and each part as plain text (a blank line = new paragraph). */
export interface EditableNotice {
  intro: string;
  sections: { title: string; text: string }[];
}

/** A part title as the page shows it (first letter kept, the rest in lower case). */
export const displayTitle = (title: string) => title.charAt(0) + title.slice(1).toLowerCase();

export function toEditable(body: string): EditableNotice {
  const { intro, sections } = parseNotice(body ?? '');
  return {
    intro: intro.join('\n\n'),
    // The editor shows each title the way the page does; it is stored in capitals.
    sections: sections.map((s) => ({ title: displayTitle(s.title), text: s.paragraphs.join('\n\n') })),
  };
}

const clean = (text: string) => text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).join('\n\n');

/** Back to the stored format. Part titles are written in capitals, as the page expects. */
export function fromEditable(n: EditableNotice): string {
  return [
    clean(n.intro),
    ...n.sections.map((s) => [s.title.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX'), clean(s.text)].filter(Boolean).join('\n\n')),
  ].filter(Boolean).join('\n\n');
}

export interface NoticeProblems {
  intro?: string;
  sections: { title?: string; text?: string }[];
  /** About the whole text (shown above the parts). */
  structure?: string;
  /** True when something would change how the page reads the text. */
  blocking: boolean;
}

const CAPITALS_PARAGRAPH = 'Un párrafo está escrito todo en mayúsculas: la página lo mostraría como un apartado nuevo. Escríbalo en minúsculas o hágalo un apartado.';

/** What would make the page show the text differently from what the editor shows. */
export function noticeProblems(n: EditableNotice): NoticeProblems {
  const capitals = (text: string) => clean(text).split('\n\n').some((p) => p && isNoticeHeading(p));
  const sections = n.sections.map((s) => {
    const title = s.title.trim();
    return {
      title: !title ? 'Escriba el título del apartado.'
        : !isNoticeHeading(title.toLocaleUpperCase('es-MX')) ? 'El título necesita al menos 15 letras para mostrarse como apartado.'
          : undefined,
      text: capitals(s.text) ? CAPITALS_PARAGRAPH : undefined,
    };
  });
  const intro = capitals(n.intro) ? CAPITALS_PARAGRAPH : undefined;
  const empty = !clean(n.intro) && n.sections.every((s) => !s.title.trim() && !clean(s.text));
  const structure = empty ? 'El aviso no tiene texto.'
    : n.sections.length < MIN_PARTS ? `Con menos de ${MIN_PARTS} apartados la página muestra el aviso como un solo texto corrido, sin apartados desplegables.`
      : undefined;
  return {
    intro, sections, structure,
    blocking: empty || !!intro || sections.some((s) => s.title || s.text),
  };
}
