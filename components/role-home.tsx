'use client'
// "My day" cards on the home screen, chosen by the person's roles. Each line opens the screen where the work is;
// lines with something waiting (amber / red, above 0) stand out.
import { ChevronRight } from 'lucide-react'
import type { HomeSection } from '@/modules/home/service'

export function RoleHome({ sections, roleLabel, onNavigate }: { sections: HomeSection[]; roleLabel: string; onNavigate: (m: string) => void }) {
  if (!sections.length) return null
  return (
    <section className="myday" aria-label="My day">
      <div className="myday-head"><h2>My day</h2><span>{roleLabel}</span></div>
      <div className="myday-grid">
        {sections.map((s) => (
          <div key={s.title} className="panel myday-card">
            <h3>{s.title}</h3>
            <div className="myday-tiles">
              {s.tiles.map((t) => {
                const waiting = (t.tone === 'amber' || t.tone === 'red') && t.value !== '0' && t.value !== '₹0'
                return (
                  <button key={t.label} type="button" className={`myday-tile tone-${t.tone}${waiting ? ' waiting' : ''}`} onClick={() => onNavigate(t.goTo)} title={`Open ${t.goTo}`}>
                    <span>{t.label}</span>
                    <strong>{t.value}</strong>
                    <ChevronRight size={14} />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
