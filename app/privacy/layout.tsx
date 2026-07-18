import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy Policy for Sysfora Technologies Private Limited. Learn how we collect, use, and protect your personal information on Anybody.',
  keywords: 'privacy policy, data protection, personal information, Sysfora, Anybody',
  alternates: {
    canonical: '/privacy',
  },
}

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
