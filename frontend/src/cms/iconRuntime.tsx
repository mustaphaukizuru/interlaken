/**
 * Icons of designed sections, without shipping the whole curated set
 * (./icons) to every public page. Each section module passes the icons its
 * own defaults use; those render at once. Any other icon an editor picks in
 * the CMS loads with the curated set on demand (a 24 px placeholder holds its
 * place, so nothing moves).
 */
import { lazy, Suspense, type ComponentType } from 'react';
import { Star, type LucideIcon, type LucideProps } from 'lucide-react';

/** Names of the curated set (./icons CMS_ICONS keys); icons.test.ts keeps them in sync. */
export const CMS_ICON_NAMES = new Set([
  'Award', 'Baby', 'BellRing', 'BookOpen', 'BookOpenCheck', 'Blocks', 'Coffee', 'Eye', 'Globe2', 'Tablet', 'Building2', 'Bus', 'CalendarDays', 'Camera', 'Check', 'CircleDollarSign',
  'ClipboardList', 'Clock', 'Computer', 'CreditCard', 'FileText', 'FlaskConical', 'GraduationCap', 'Heart', 'HeartHandshake',
  'Languages', 'Laptop', 'Leaf', 'Lightbulb', 'Mail', 'MapPin', 'MessageCircle', 'Music', 'Palette', 'Pencil', 'Phone', 'Receipt',
  'ShieldCheck', 'Smile', 'Sparkles', 'Star', 'Target', 'Trophy', 'TrendingUp', 'Users', 'Utensils',
]);

type IconProps = Omit<LucideProps, 'ref'>;
type IconComponent = ComponentType<IconProps>;
const onDemand = new Map<string, IconComponent>();

function lazyIcon(name: string): IconComponent {
  let C = onDemand.get(name);
  if (!C) {
    const L = lazy(async () => ({ default: (await import('./icons')).CMS_ICONS[name] ?? Star }));
    const Icon = (props: IconProps) => {
      const size = props.size ?? 24;
      return (
        <Suspense fallback={<span className={props.className} style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />}>
          <L {...props} />
        </Suspense>
      );
    };
    Icon.displayName = `CmsIcon(${name})`;
    C = Icon;
    onDemand.set(name, C);
  }
  return C;
}

/**
 * `const cmsIcon = iconResolver({ Users, Heart })` in a section module, then
 * `cmsIcon(props.icon)`: a known icon of the module renders directly, another
 * curated icon loads on demand, an empty or unknown name gives `fallback`.
 */
export function iconResolver(local: Record<string, LucideIcon>) {
  return (name: unknown, fallback: LucideIcon = Star): IconComponent => {
    const key = typeof name === 'string' ? name : '';
    if (local[key]) return local[key];
    if (key && CMS_ICON_NAMES.has(key)) return lazyIcon(key);
    return fallback;
  };
}
