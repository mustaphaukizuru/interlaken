/** Curated icon set for CMS sections (field kind 'icon'). */
import {
  Award, Baby, BellRing, BookOpen, BookOpenCheck, Blocks, Coffee, Eye, Globe2, Tablet, Building2, Bus, CalendarDays, Camera, Check, CircleDollarSign,
  ClipboardList, Clock, Computer, CreditCard, FileText, FlaskConical, GraduationCap, Heart, HeartHandshake,
  Languages, Laptop, Leaf, Lightbulb, Mail, MapPin, MessageCircle, Music, Palette, Pencil, Phone, Receipt,
  ShieldCheck, Smile, Sparkles, Star, Target, Trophy, TrendingUp, Users, Utensils, type LucideIcon,
} from 'lucide-react';

export const CMS_ICONS: Record<string, LucideIcon> = {
  Award, Baby, BellRing, BookOpen, BookOpenCheck, Blocks, Coffee, Eye, Globe2, Tablet, Building2, Bus, CalendarDays, Camera, Check, CircleDollarSign,
  ClipboardList, Clock, Computer, CreditCard, FileText, FlaskConical, GraduationCap, Heart, HeartHandshake,
  Languages, Laptop, Leaf, Lightbulb, Mail, MapPin, MessageCircle, Music, Palette, Pencil, Phone, Receipt,
  ShieldCheck, Smile, Sparkles, Star, Target, Trophy, TrendingUp, Users, Utensils,
};
// 'WhatsApp' is the brand glyph (components/icons/WhatsAppIcon); sections that offer it render it themselves.
export const ICON_OPTIONS = [...Object.keys(CMS_ICONS), 'WhatsApp'].map((k) => ({ value: k, label: k }));
export const cmsIcon = (name: unknown, fallback: LucideIcon = Star): LucideIcon =>
  (typeof name === 'string' && CMS_ICONS[name]) || fallback;
