import type { Metadata } from "next";
import { Home } from "@/components/Home/Home";

export const metadata: Metadata = {
  title: "Anybody - The Open-Source AI App Builder",
};

export default function HomePage() {
  return (
    <Home />
  );
}
