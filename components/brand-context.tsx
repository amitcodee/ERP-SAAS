'use client'
// The institute's brand for client components (login pages, the panel frame): set once by a server layout.
import { createContext, useContext } from 'react'
import type { Brand } from '@/lib/brand'

export const NEUTRAL_BRAND: Brand = { name: 'Institute', legalName: 'Institute', tagline: '', color: '#10186a', logo: null, accreditations: null, initials: 'IN', contact: { address: '', phone: '', website: '', social: '' } }
const Ctx = createContext<Brand>(NEUTRAL_BRAND)

export function BrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <Ctx.Provider value={brand}>{children}</Ctx.Provider>
}
export const useBrand = () => useContext(Ctx)
