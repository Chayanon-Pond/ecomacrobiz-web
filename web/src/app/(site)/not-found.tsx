import { NotFoundView } from "@/components/layout/NotFoundView";

/** notFound() thrown inside public routes (e.g. unknown /knowledge/[slug]). */
export default function SiteNotFound() {
  return <NotFoundView />;
}
