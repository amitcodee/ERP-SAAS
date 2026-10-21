// An institute's logo, or (none uploaded) its initials on a tile of its colour with its name beside: the neutral mark.
import type { Brand } from '@/lib/brand'

export function BrandMark({ brand, height = 36, showName = true, light = false }: { brand: Pick<Brand, 'name' | 'logo' | 'color' | 'initials'>; height?: number; showName?: boolean; light?: boolean }) {
  if (brand.logo) return <img src={brand.logo} alt={brand.name} style={{ height, width: 'auto', maxWidth: height * 5, objectFit: 'contain', display: 'block' }} />
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height / 4) }} aria-label={brand.name}>
      <span aria-hidden="true" style={{ width: height, height, borderRadius: Math.round(height / 4), background: brand.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: Math.round(height * 0.42), letterSpacing: '-.02em', flex: 'none' }}>{brand.initials}</span>
      {showName && <b style={{ fontSize: Math.round(height * 0.44), fontWeight: 800, color: light ? '#fff' : brand.color, letterSpacing: '-.02em', lineHeight: 1.1 }}>{brand.name}</b>}
    </span>
  )
}
