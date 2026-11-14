import type { MetadataRoute } from "next";
import { site } from "@/content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/admin/", "/api/", "/account", "/account/"] },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
