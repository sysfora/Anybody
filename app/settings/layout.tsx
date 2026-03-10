import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings - Anybody.dev",
  description: "Manage your account settings, profile, password, credits, and preferences.",
  keywords: ["settings", "account settings", "profile", "preferences", "Anybody.dev"],
  openGraph: {
    title: "Settings - Anybody.dev",
    description: "Manage your account settings, profile, password, credits, and preferences.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Settings - Anybody.dev",
    description: "Manage your account settings, profile, password, credits, and preferences.",
  },
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

