import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/chat",
          "/chat/",
          "/settings",
          "/projects",
          "/team",
          "/subscription-success",
          "/invite/",
          "/verify-account",
          "/reset-password",
          "/registration-succesful",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
