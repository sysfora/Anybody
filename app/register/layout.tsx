import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register - Anybody.dev",
  description: "Create your Anybody.dev account and start building AI apps faster with our powerful platform.",
  keywords: ["register", "sign up", "AI app builder", "Anybody.dev", "account creation"],
  openGraph: {
    title: "Register - Anybody.dev",
    description: "Create your Anybody.dev account and start building AI apps faster with our powerful platform.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Register - Anybody.dev",
    description: "Create your Anybody.dev account and start building AI apps faster with our powerful platform.",
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
