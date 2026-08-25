import { type HTMLAttributes } from 'react';

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Horizontal max-width. Defaults to the standard 6xl content width. */
  size?: 'md' | 'lg' | 'xl';
}

const MAX: Record<NonNullable<ContainerProps['size']>, number> = {
  md: 880,
  lg: 1120,
  xl: 1280,
};

/**
 * Centered max-width wrapper with consistent horizontal padding.
 * Replaces the repeated `margin: 0 auto; padding: 0 24px; max-width` inline blocks.
 */
export function Container({ size = 'lg', className = '', style, children, ...props }: ContainerProps) {
  return (
    <div
      // Gutter as classes (not inline) so pages can override it and phones get
      // 20px instead of a fixed 24px; nested containers no longer double up.
      className={`mx-auto w-full px-5 sm:px-6 lg:px-8 ${className}`.trim()}
      style={{ maxWidth: MAX[size], ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export default Container;
