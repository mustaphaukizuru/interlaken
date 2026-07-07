interface LogoProps {
  variant?: 'icon' | 'horizontal' | 'stacked'
  size?: number
  theme?: 'light' | 'dark'
}

export default function Logo({ variant = 'horizontal', size = 40, theme = 'dark' }: LogoProps) {
  if (variant === 'icon') {
    return (
      <img
        src="/assets/logo-interlaken.webp"
        alt="Colegio Interlaken"
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  if (variant === 'stacked') {
    return (
      <img
        src="/assets/logo-stacked.webp"
        alt="Colegio Interlaken"
        height={size}
        style={{ objectFit: 'contain' }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  // horizontal — logo icon + text
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <img
        src="/assets/logo-interlaken.webp"
        alt="Colegio Interlaken"
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
        onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
      />
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 11, letterSpacing: 3, color: '#4ec06a', textTransform: 'uppercase' }}>COLEGIO</div>
        <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: size * 0.38, color: theme === 'dark' ? '#3aa852' : '#2f9447', letterSpacing: -0.3 }}>INTERLAKEN</div>
      </div>
    </div>
  )
}
