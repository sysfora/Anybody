import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team - Anybody.dev",
  description: "Manage your team members, invitations, and collaborate on AI projects together.",
  keywords: ["team", "collaboration", "team management", "invitations", "Anybody.dev"],
  openGraph: {
    title: "Team - Anybody.dev",
    description: "Manage your team members, invitations, and collaborate on AI projects together.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Team - Anybody.dev",
    description: "Manage your team members, invitations, and collaborate on AI projects together.",
  },
};

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

