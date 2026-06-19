import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service - Anybody',
  description: 'Terms of Service for Sysfora Technologies Private Limited. Read our terms and conditions for using our products and services.',
  keywords: 'terms of service, terms and conditions, user agreement, Sysfora, technology',
}

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
