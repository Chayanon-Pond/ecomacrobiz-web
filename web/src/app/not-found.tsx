import { SiteChrome } from "@/components/layout/SiteChrome";
import { NotFoundView } from "@/components/layout/NotFoundView";

/** Unmatched URLs render outside the (site) group, so wrap in the public chrome. */
export default function NotFound() {
  return (
    <SiteChrome>
      <NotFoundView />
    </SiteChrome>
  );
}
