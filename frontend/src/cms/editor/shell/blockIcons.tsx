import {
  Award, BarChart3, BookOpen, Calculator, Calendar, ClipboardList, CreditCard, Download, FileInput, FileText, Film, Footprints,
  HelpCircle, Images, LayoutGrid, LayoutTemplate, Lock, Mail, MapPin, Megaphone, MessageSquareQuote, MousePointerClick,
  PanelTop, Receipt, ScrollText, SearchX, ShieldCheck, Table2, Target, Type, Users, type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';

/** First rule whose token appears in the block type wins (designed sections are `<page>.<name>`). */
const RULES: [string[], LucideIcon][] = [
  [['hero'], PanelTop],
  [['form', 'request', 'booking', 'lead'], FileInput],
  [['faq'], HelpCircle],
  [['stats'], BarChart3],
  [['gallery', 'galeria', 'grid', 'image'], Images],
  [['video'], Film],
  [['testimonial'], MessageSquareQuote],
  [['timeline'], Footprints],
  [['steps'], ClipboardList],
  [['estimator'], Calculator],
  [['prices', 'pricing'], Table2],
  [['map'], MapPin],
  [['directory', 'contact'], Mail],
  [['calendar', 'events'], Calendar],
  [['cta', 'promos'], MousePointerClick],
  [['platforms'], CreditCard],
  [['download'], Download],
  [['notice', 'notices'], ScrollText],
  [['docs', 'list'], FileText],
  [['sep', 'credentials', 'trust'], ShieldCheck],
  [['mission', 'values', 'pillars', 'strengths'], Target],
  [['levels', 'programs', 'feature', 'others', 'cards'], LayoutGrid],
  [['about', 'content', 'rich_text', 'text'], Type],
  [['message'], SearchX],
  [['community'], Users],
  [['facturacion'], Receipt],
  [['modelo'], BookOpen],
  [['award'], Award],
  [['announce'], Megaphone],
];

/** Section-type icon for the block list. Locked sections (forms, booking) show a lock. */
function blockIcon(type: string, locked = false): LucideIcon {
  if (locked) return Lock;
  const name = type.toLowerCase();
  const part = name.includes('.') ? name.slice(name.indexOf('.') + 1) : name;
  for (const [tokens, icon] of RULES) if (tokens.some((t) => part.includes(t))) return icon;
  for (const [tokens, icon] of RULES) if (tokens.some((t) => name.includes(t))) return icon;
  return LayoutTemplate;
}

/** The icon of a block type as an element (one lookup table, no component created during render). */
export function BlockIcon({ type, locked = false, size = 15 }: { type: string; locked?: boolean; size?: number }) {
  return createElement(blockIcon(type, locked), { size, 'aria-hidden': true });
}
