import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription",
  description:
    "Choose an Anybody plan and manage billing. Upgrade for more credits and private projects.",
  keywords: ["subscription", "billing", "pricing", "Anybody.dev"],
  alternates: {
    canonical: "/subscription",
  },
  openGraph: {
    title: "Subscription | Anybody",
    description:
      "Choose an Anybody plan and manage billing. Upgrade for more credits and private projects.",
    type: "website",
    url: "/subscription",
  },
  twitter: {
    card: "summary",
    title: "Subscription | Anybody",
    description:
      "Choose an Anybody plan and manage billing. Upgrade for more credits and private projects.",
  },
};

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

