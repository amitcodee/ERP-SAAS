import { PageSkeleton } from '@/components/page-skeleton'

// Shown at once while a panel page loads its data; the sidebar and top bar stay as they are.
export default function Loading() {
  return <PageSkeleton />
}
