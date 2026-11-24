import type { Metadata } from 'next'

// The page is a client component, which can't export metadata itself.
export const metadata: Metadata = { title: 'Dashboard · Arc VRF' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
