import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password - Anybody.dev",
  description: "Set a new password for your Anybody.dev account. Enter your new password to complete the reset process.",
  keywords: ["reset password", "new password", "AI app builder", "Anybody.dev", "password change"],
  openGraph: {
    title: "Reset Password - Anybody.dev",
    description: "Set a new password for your Anybody.dev account. Enter your new password to complete the reset process.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Reset Password - Anybody.dev",
    description: "Set a new password for your Anybody.dev account. Enter your new password to complete the reset process.",
  },
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
