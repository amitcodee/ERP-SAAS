import { KeyRound, Link2 } from 'lucide-react'
import { FindForm } from '@/components/site/forms'
import { SiteAuth } from '@/components/site/shell'

export const metadata = { title: 'Find your institute' }

// Institutes sign in at their own address. Someone who does not remember it gets it by e-mail.
export default function Find() {
  return (
    <SiteAuth>
      <h1>Find your <span className="hl">institute</span></h1>
      <p className="lead">Staff and students sign in at their institute’s own address. Enter your e-mail and we send you the sign-in link of every institute you belong to.</p>
      <FindForm />
      <ul className="au-perks" style={{ marginTop: 24 }}><li><Link2 size={16} /> Bookmark your institute’s address once you have it</li><li><KeyRound size={16} /> Forgot your password? Use “Forgot password” on its sign-in page</li></ul>
    </SiteAuth>
  )
}
