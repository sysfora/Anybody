import type { Metadata } from "next";
import { ChatShell } from "./chat-shell";

export const metadata: Metadata = {
  title: "Chat - Anybody.dev",
  description: "Build and modify your AI-powered applications with natural language.",
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ChatShell />
      {children}
    </>
  );
}

