import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accept Invitation - Anybody.dev",
  description: "Accept your team invitation and start collaborating on AI projects with your team members.",
  keywords: ["team invitation", "accept invitation", "collaboration", "Anybody.dev"],
  openGraph: {
    title: "Accept Invitation - Anybody.dev",
    description: "Accept your team invitation and start collaborating on AI projects with your team members.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Accept Invitation - Anybody.dev",
    description: "Accept your team invitation and start collaborating on AI projects with your team members.",
  },
};

export default function InviteAcceptLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}

