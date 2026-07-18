import type { Metadata } from "next";
import Background from "@/components/Home/Background";
import { Navbar } from "@/components/Home/Navbar";
import Footer from "@/components/Home/Footer";
import { PublicProjects } from "@/components/Home/PublicProjects";

export const metadata: Metadata = {
  title: "Showcase",
  description:
    "Discover public apps and projects built with Anybody, the open-source AI app builder.",
  alternates: {
    canonical: "/showcase",
  },
  openGraph: {
    title: "Showcase | Anybody",
    description:
      "Discover public apps and projects built with Anybody, the open-source AI app builder.",
    url: "/showcase",
  },
};

export default function ShowcasePage() {
  return (
    <>
      <Background />
      <div className="min-h-screen flex flex-col relative overflow-x-hidden">
        <Navbar />
        <main className="flex-1 bg-transparent pt-24 sm:pb-20">
          <PublicProjects />
        </main>
        <Footer />
      </div>
    </>
  );
}
