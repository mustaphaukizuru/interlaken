import { type HTMLAttributes } from 'react';
import { Container } from './Container';

type BgVariant = 'white' | 'cream' | 'dark' | 'gradient' | 'none';

interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Background treatment. */
  bg?: BgVariant;
  /** Vertical padding rhythm. */
  spacing?: 'sm' | 'md' | 'lg';
  /** Wrap children in a <Container>. Set false to control the inner width manually. */
  container?: boolean;
  containerSize?: 'md' | 'lg' | 'xl';
}

const PAD: Record<NonNullable<SectionProps['spacing']>, string> = {
  sm: '48px 0',
  md: '72px 0',
  lg: '96px 0',
};

const BG: Record<BgVariant, React.CSSProperties> = {
  white: { background: 'white', color: 'var(--text-main)' },
  cream: { background: 'var(--cream-2)', color: 'var(--text-main)' },
  dark: { background: 'var(--dark)', color: 'white' },
  gradient: { background: 'var(--grad-cta)', color: 'white' },
  none: {},
};

/**
 * Standard page section: consistent vertical rhythm + background variants.
 * Removes the repeated `padding: 72px 0; background: …` inline blocks on the public pages.
 */
export function Section({
  bg = 'white',
  spacing = 'md',
  container = true,
  containerSize = 'lg',
  style,
  children,
  ...props
}: SectionProps) {
  return (
    <section style={{ padding: PAD[spacing], ...BG[bg], ...style }} {...props}>
      {container ? <Container size={containerSize}>{children}</Container> : children}
    </section>
  );
}

export default Section;
