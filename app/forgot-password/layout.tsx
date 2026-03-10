import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password - Anybody.dev",
  description: "Reset your Anybody.dev account password. Enter your email to receive a password reset link.",
  keywords: ["forgot password", "password reset", "AI app builder", "Anybody.dev", "account recovery"],
  openGraph: {
    title: "Forgot Password - Anybody.dev",
    description: "Reset your Anybody.dev account password. Enter your email to receive a password reset link.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Forgot Password - Anybody.dev",
    description: "Reset your Anybody.dev account password. Enter your email to receive a password reset link.",
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
