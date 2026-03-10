import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose Plan - Anybody.dev",
  description: "Choose the perfect plan for your AI development needs. Flexible pricing options to scale with your projects.",
  keywords: ["pricing", "plans", "subscription", "AI app builder", "Anybody.dev"],
  openGraph: {
    title: "Choose Plan - Anybody.dev",
    description: "Choose the perfect plan for your AI development needs. Flexible pricing options to scale with your projects.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Choose Plan - Anybody.dev",
    description: "Choose the perfect plan for your AI development needs. Flexible pricing options to scale with your projects.",
  },
};

export default function ChoosePlanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

