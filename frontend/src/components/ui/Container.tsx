import { type HTMLAttributes } from 'react';

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Horizontal max-width. Defaults to `lg`, the public header/footer width. */
  size?: 'md' | 'lg' | 'xl';
}

// `lg` = the public header and footer (`max-w-6xl px-4 sm:px-6`,
// PublicLayout.tsx), so section content lines up with the logo and the
// footer columns at every width. `md` is the reading width, `xl` the wide one.
// Hand-built bands (heroes) use the same `mx-auto max-w-6xl px-4 sm:px-6`.
const MAX: Record<NonNullable<ContainerProps['size']>, string> = {
  md: 'max-w-4xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
};

/** Centered max-width wrapper with the site's gutter (16px on phones, 24px from `sm`). */
export function Container({ size = 'lg', className = '', children, ...props }: ContainerProps) {
  return (
    <div className={`mx-auto w-full ${MAX[size]} px-4 sm:px-6 ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export default Container;
