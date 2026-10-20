import { redirect } from 'next/navigation'

// Batches & attendance now live under Students.
export default function Page() {
  redirect('/students?tab=batches')
}
