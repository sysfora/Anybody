import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy - Anybody',
  description: 'Privacy Policy for Sysfora Technologies Private Limited. Learn about how we collect, use, and protect your personal information.',
  keywords: 'privacy policy, data protection, personal information, Sysfora, technology',
}

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
