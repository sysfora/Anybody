import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription - Anybody.dev",
  description: "Manage your subscription and billing settings.",
  keywords: ["subscription", "billing", "manage", "Anybody.dev"],
  openGraph: {
    title: "Subscription - Anybody.dev",
    description: "Manage your subscription and billing settings.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Subscription - Anybody.dev",
    description: "Manage your subscription and billing settings.",
  },
};

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

