import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription Success - Anybody.dev",
  description: "Thank you for subscribing! Your payment has been processed successfully and your account has been upgraded.",
  keywords: ["subscription success", "payment success", "upgrade", "Anybody.dev"],
  openGraph: {
    title: "Subscription Success - Anybody.dev",
    description: "Thank you for subscribing! Your payment has been processed successfully and your account has been upgraded.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Subscription Success - Anybody.dev",
    description: "Thank you for subscribing! Your payment has been processed successfully and your account has been upgraded.",
  },
};

export default function SubscriptionSuccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

