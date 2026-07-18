import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
  description: "Log in to your Anybody account to continue building AI apps faster.",
  keywords: ["login", "authentication", "AI app builder", "Anybody.dev"],
  alternates: {
    canonical: "/login",
  },
  openGraph: {
    title: "Login | Anybody",
    description: "Log in to your Anybody account to continue building AI apps faster.",
    type: "website",
    url: "/login",
  },
  twitter: {
    card: "summary",
    title: "Login | Anybody",
    description: "Log in to your Anybody account to continue building AI apps faster.",
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
