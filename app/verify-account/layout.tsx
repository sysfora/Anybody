import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify Account - Anybody.dev",
  description: "Verify your Anybody.dev account email address to complete your registration and start building AI apps.",
  keywords: ["verify account", "email verification", "AI app builder", "Anybody.dev", "account activation"],
  openGraph: {
    title: "Verify Account - Anybody.dev",
    description: "Verify your Anybody.dev account email address to complete your registration and start building AI apps.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Verify Account - Anybody.dev",
    description: "Verify your Anybody.dev account email address to complete your registration and start building AI apps.",
  },
};

export default function VerifyAccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
