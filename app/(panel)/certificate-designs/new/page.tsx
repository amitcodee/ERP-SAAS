export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { CertDesigner } from '@/components/cert-designer'
import { PRESETS, presetDesign, type Design } from '@/lib/cert-design'
import { requirePage } from '@/lib/panel/base'

// A new design on the canvas: ?start=<template> | blank | portrait (a blank portrait page). Nothing is saved until Save.
export default async function Page({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const b = await requirePage('Certificate Designs')
  if (!b.ok('update', 'certdesign')) redirect('/certificate-designs')
  const start = (await searchParams).start ?? 'blank'
  const preset = PRESETS.find((p) => p.key === start)
  const design: Design = preset ? presetDesign(preset.key) : { page: start === 'portrait' ? 'portrait' : 'landscape', bg: '#ffffff', els: [] }
  return <CertDesigner id={null} initialName={preset ? preset.name.split(' — ')[0] + ' certificate' : 'New certificate'} initial={design} />
}
