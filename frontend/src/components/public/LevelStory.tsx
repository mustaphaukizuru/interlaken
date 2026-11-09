import { Fragment, type ReactNode } from 'react';
import { BookOpenText, Calculator, MessageCircle } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { assetSrcSet } from '@/lib/images';
import type { LevelData } from '@/lib/levels';
import { LEVEL_STORIES, type LevelProgram, type StoryBlock } from '@/lib/levelStories';

const PROGRAM_ICON: Record<LevelProgram['icon'], typeof BookOpenText> = {
  reading: BookOpenText,
  speaking: MessageCircle,
  math: Calculator,
};

/** The document's **bold** phrases as <strong>; everything else as written. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{part}</strong> : <Fragment key={i}>{part}</Fragment>))}</>;
}

const PARAGRAPH = 'text-[17px] leading-[1.75] text-ink/80';

function Block({ block, color, lede }: { block: StoryBlock; color: string; lede: boolean }): ReactNode {
  if ('quote' in block) {
    return (
      <blockquote className="border-l-4 py-1 pl-5 sm:pl-6" style={{ borderColor: color }}>
        <p className="text-balance font-head text-fluid-xl font-bold leading-snug text-ink">{block.quote}</p>
      </blockquote>
    );
  }
  if ('programs' in block) {
    return (
      <ul className="space-y-3" aria-label="Programas">
        {block.programs.map((pr) => {
          const Icon = PROGRAM_ICON[pr.icon];
          // "**Lee y Produce** impulsa…" reads as a run-in under the card title, so the name is not said twice.
          const lead = `**${pr.name}** `;
          const body = pr.text.startsWith(lead) ? pr.text.slice(lead.length) : pr.text;
          return (
            <li key={pr.name} className="flex gap-4 rounded-xl2 border border-line bg-cream-2 p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink" style={{ background: `${color}26` }}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="font-head text-base font-bold text-ink">{pr.name}</h3>
                <p className="mt-1 text-[16px] leading-relaxed text-ink/80"><Rich text={body} /></p>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <p className={lede ? 'text-lg leading-[1.7] text-ink sm:text-xl' : PARAGRAPH}>
      <Rich text={block.p} />
    </p>
  );
}

/**
 * The level's own text (src/lib/levelStories.ts), set for reading: one column of
 * about 68 characters, the school's bold phrases kept, its one-line
 * statements as pull-quotes, and a photo of the school partway through.
 */
export function LevelStory({ level }: { level: LevelData }) {
  const { story, photo } = LEVEL_STORIES[level.slug];
  return (
    <div className="max-w-[68ch] space-y-14 sm:space-y-16">
      {story.map((section, i) => {
        const id = section.title ? `${level.slug}-${i}` : undefined;
        return (
          <Fragment key={section.title ?? 'apertura'}>
            <Reveal>
              <section aria-labelledby={id} className="space-y-5">
                {section.title && (
                  <header>
                    <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full" style={{ background: level.color }} />
                    <h2 id={id} className="text-balance font-head text-fluid-2xl font-bold leading-tight text-ink">{section.title}</h2>
                  </header>
                )}
                {section.blocks.map((block, j) => (
                  <Block key={j} block={block} color={level.color} lede={i === 0 && j === 0} />
                ))}
              </section>
            </Reveal>
            {photo.after === i && (
              <Reveal>
                <figure className="overflow-hidden rounded-xl2 bg-cream-2">
                  <img
                    src={photo.src}
                    srcSet={assetSrcSet(photo.src)}
                    sizes="(min-width: 1024px) 680px, 100vw"
                    alt={photo.alt}
                    width={1600}
                    height={900}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[16/9] w-full object-cover"
                  />
                </figure>
              </Reveal>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export default LevelStory;
