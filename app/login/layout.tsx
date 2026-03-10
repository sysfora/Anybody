import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login - Anybody.dev",
  description: "Login to your Anybody.dev account to continue building AI apps faster.",
  keywords: ["login", "authentication", "AI app builder", "Anybody.dev"],
  openGraph: {
    title: "Login - Anybody.dev",
    description: "Login to your Anybody.dev account to continue building AI apps faster.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Login - Anybody.dev",
    description: "Login to your Anybody.dev account to continue building AI apps faster.",
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
