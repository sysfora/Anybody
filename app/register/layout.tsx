import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register",
  description:
    "Create your Anybody account and start building AI apps faster with our open-source platform.",
  keywords: ["register", "sign up", "AI app builder", "Anybody.dev", "account creation"],
  alternates: {
    canonical: "/register",
  },
  openGraph: {
    title: "Register | Anybody",
    description:
      "Create your Anybody account and start building AI apps faster with our open-source platform.",
    type: "website",
    url: "/register",
  },
  twitter: {
    card: "summary",
    title: "Register | Anybody",
    description:
      "Create your Anybody account and start building AI apps faster with our open-source platform.",
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
