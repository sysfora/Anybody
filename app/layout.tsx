import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@teispace/next-themes";
import { getTheme } from "@teispace/next-themes/server";
import { Toaster } from "@/components/ui/sonner";
import { ProjectProvider } from "@/context/ProjectContext";
import { Roboto } from "next/font/google";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Anybody.dev — AI App Builder",
  description: "Build AI apps faster with Anybody.dev",
  icons: {
    icon: "/Favicon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialTheme = await getTheme();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${roboto.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          initialTheme={initialTheme ?? undefined}
        >
          <ProjectProvider>
            {children}
            <Toaster />
          </ProjectProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
