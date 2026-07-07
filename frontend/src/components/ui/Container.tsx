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
export function Container({ size = 'lg', style, children, ...props }: ContainerProps) {
  return (
    <div
      style={{ width: '100%', maxWidth: MAX[size], margin: '0 auto', padding: '0 24px', ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export default Container;
