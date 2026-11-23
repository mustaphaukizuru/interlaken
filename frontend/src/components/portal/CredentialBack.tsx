import { CreditCard, Globe, MapPin, Phone } from 'lucide-react';
import { ORG, SITE_URL } from '@/lib/siteMeta';
import { levelOf, schoolCycle, validityShort, validUntil, type Level } from '@/lib/credential';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import type { CafeteriaCard } from '@/types';

/**
 * The back of the digital credencial (owner, 2026-11-22): the school's
 * identity, how the card is used, what to do if it is found, and the
 * validity, as on the back of a printed ID. Same CR80 landscape artboard and
 * container-unit type as the front (CredentialFace). Built from the school's
 * public data (siteMeta ORG and the site settings), no invented details;
 * the printed card's back can replace this layout when the school sends it.
 */
const LEVEL_BG: Record<Level, string> = {
  maternal: 'bg-nivel-preescolar',
  preescolar: 'bg-nivel-preescolar',
  primaria: 'bg-nivel-primaria',
  secundaria: 'bg-nivel-secundaria',
};

export function CredentialBack({ card, className = '' }: { card: CafeteriaCard; className?: string }) {
  const s = card.student;
  const staff = s.tipo === 'personal';
  const level = staff ? null : levelOf(s.grade);
  const settings = useSiteSettings();
  const phone = settings.phone_display || ORG.telephone.replace(/^\+52-/, '').replace(/-/g, ' ');
  const site = SITE_URL.replace(/^https?:\/\//, '');

  return (
    <section
      aria-label={`Reverso de la credencial de ${s.name}`}
      className={`credencial relative flex aspect-[4050/2550] flex-col overflow-hidden rounded-md bg-white font-head text-credencial-ink shadow-lg ring-1 ring-black/5 ${className}`}
    >
      {/* Header: the school's logo (it carries the name) on the navy of the front's band. */}
      <div className="flex items-center justify-between gap-[2.4cqw] bg-credencial-navy px-[4cqw] py-[2.2cqw] text-white">
        <img src="/assets/credencial/logo.webp" alt="Colegio Interlaken" className="h-[11cqw] w-auto flex-shrink-0" />
        <div className="min-w-0 text-right">
          <p className="cred-value font-bold">{staff ? 'Credencial del personal' : 'Credencial de alumno'}</p>
          <p className="cred-label font-semibold uppercase tracking-[0.08em] text-white/75">Cafetería del colegio</p>
        </div>
      </div>
      <div className={`h-[1.2cqw] ${level ? LEVEL_BG[level] : 'bg-purple-xlight'}`} aria-hidden="true" />

      <div className="grid flex-1 grid-cols-[1.35fr_1fr] items-center gap-[3cqw] px-[4cqw] py-[2.6cqw]">
        <div className="cred-back-text space-y-[1.4cqw] text-credencial-ink/85">
          <p className="flex gap-[1.2cqw]">
            <CreditCard className="mt-[0.3cqw] h-[2.6cqw] w-[2.6cqw] flex-shrink-0 text-credencial-navy" aria-hidden="true" />
            <span><strong className="text-credencial-ink">Personal e intransferible.</strong> Preséntela en la cafetería del colegio para pagar con el saldo de la cuenta.</span>
          </p>
          <p className="pl-[3.8cqw]">Si la encuentra, por favor entréguela en la recepción del colegio.</p>
        </div>
        <dl className="space-y-[1.2cqw] border-l border-credencial-navy/15 pl-[3cqw]">
          <div>
            <dt className="cred-label font-semibold uppercase tracking-[0.08em]">Vigencia</dt>
            <dd className="cred-value font-bold">{validityShort(validUntil())}</dd>
          </div>
          <div>
            <dt className="cred-label font-semibold uppercase tracking-[0.08em]">Ciclo escolar</dt>
            <dd className="cred-value font-bold">{schoolCycle()}</dd>
          </div>
          <div>
            <dt className="cred-label font-semibold uppercase tracking-[0.08em]">{staff ? 'Código' : 'Matrícula'}</dt>
            <dd className="cred-value truncate font-bold">{card.code || '—'}</dd>
          </div>
        </dl>
      </div>

      {/* Footer: how to reach the school. */}
      <div className="cred-back-small flex flex-wrap items-center gap-x-[2.6cqw] gap-y-[0.6cqw] bg-cream px-[4cqw] py-[2cqw] text-credencial-ink/80">
        <span className="inline-flex items-center gap-[0.8cqw]"><MapPin className="h-[2.2cqw] w-[2.2cqw]" aria-hidden="true" />{ORG.streetAddress}, {ORG.addressLocality}</span>
        <span className="inline-flex items-center gap-[0.8cqw]"><Phone className="h-[2.2cqw] w-[2.2cqw]" aria-hidden="true" />{phone}</span>
        <span className="inline-flex items-center gap-[0.8cqw]"><Globe className="h-[2.2cqw] w-[2.2cqw]" aria-hidden="true" />{site}</span>
      </div>
    </section>
  );
}

export default CredentialBack;
