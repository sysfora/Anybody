import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of Service for Sysfora Technologies Private Limited. Read the terms and conditions for using Anybody and related products.',
  keywords: 'terms of service, terms and conditions, user agreement, Sysfora, Anybody',
  alternates: {
    canonical: '/terms',
  },
}

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
