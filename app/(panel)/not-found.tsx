import { NotFoundView } from '@/components/not-found-view'

// A record a panel page cannot find (e.g. /fees/<id> of a student who is not there): shown inside the panel's frame.
export default function NotFound() {
  return <NotFoundView inPanel />
}
