import { useQuery } from '@tanstack/react-query';
import { Quote } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { testimonialsQuery } from './testimonialsQuery';

/** Published family/alumni quotes (BACKLOG P2-15). Renders nothing when the school has none. */
export function Testimonials({ limit = 3, title = 'Lo que dicen las familias', eyebrow = 'Comunidad' }: { limit?: number; title?: string; eyebrow?: string }) {
  const { data, isLoading } = useQuery(testimonialsQuery);
  const items = (data ?? []).slice(0, limit);
  // Loading: reserve the space so the page below does not jump when quotes land.
  if (isLoading) {
    return (
      <div aria-hidden="true" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[168px] rounded-md" />)}
      </div>
    );
  }
  if (items.length === 0) return null;
  return (
    <div>
      <Reveal className="mb-8 text-center">
        {eyebrow && <span className="section-label-pink inline-flex">{eyebrow}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{title}</h2>
      </Reveal>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((t, i) => (
          <Reveal key={t.id} delay={i * 70}>
            <li className="card h-full">
              <Quote size={22} className="text-pink" aria-hidden="true" />
              <blockquote className="mt-3 text-[15px] leading-relaxed text-ink">“{t.quote}”</blockquote>
              <footer className="mt-4 text-sm">
                <span className="font-semibold text-ink">{t.author}</span>
                {t.role && <span className="block text-xs text-muted">{t.role}</span>}
              </footer>
            </li>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}

export default Testimonials;
