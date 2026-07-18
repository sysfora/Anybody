import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password",
  description:
    "Reset your Anybody account password. Enter your email to receive a password reset link.",
  keywords: ["forgot password", "password reset", "Anybody.dev", "account recovery"],
  alternates: {
    canonical: "/forgot-password",
  },
  openGraph: {
    title: "Forgot Password | Anybody",
    description:
      "Reset your Anybody account password. Enter your email to receive a password reset link.",
    type: "website",
    url: "/forgot-password",
  },
  twitter: {
    card: "summary",
    title: "Forgot Password | Anybody",
    description:
      "Reset your Anybody account password. Enter your email to receive a password reset link.",
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
