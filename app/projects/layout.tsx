import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects - Anybody.dev",
  description: "Manage your AI-powered projects. View, edit, and deploy your applications with ease.",
  keywords: ["projects", "project management", "AI applications", "Anybody.dev"],
  openGraph: {
    title: "Projects - Anybody.dev",
    description: "Manage your AI-powered projects. View, edit, and deploy your applications with ease.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Projects - Anybody.dev",
    description: "Manage your AI-powered projects. View, edit, and deploy your applications with ease.",
  },
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

