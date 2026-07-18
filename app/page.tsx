import type { Metadata } from "next";
import { Home } from "@/components/Home/Home";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    absolute: `${SITE_NAME} — The Open-Source AI App Builder`,
  },
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  return (
    <Home />
  );
}
