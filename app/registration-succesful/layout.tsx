import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Registration Successful - Anybody.dev",
  description: "Your Anybody.dev account has been created successfully! Check your email to verify your account and start building AI apps.",
  keywords: ["registration successful", "account created", "AI app builder", "Anybody.dev", "email verification"],
  openGraph: {
    title: "Registration Successful - Anybody.dev",
    description: "Your Anybody.dev account has been created successfully! Check your email to verify your account and start building AI apps.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Registration Successful - Anybody.dev",
    description: "Your Anybody.dev account has been created successfully! Check your email to verify your account and start building AI apps.",
  },
};

export default function RegistrationSuccessfulLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
