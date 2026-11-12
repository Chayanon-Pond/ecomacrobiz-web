import type { Metadata } from "next";
import { Hero } from "@/components/sections/Hero";
import { WhoWeAre } from "@/components/sections/WhoWeAre";
import { DesigningSequence } from "@/components/sections/DesigningSequence";
import { Numbers } from "@/components/sections/Numbers";
import { Sustainability } from "@/components/sections/Sustainability";
import { Foundation } from "@/components/sections/Foundation";
import { CapabilityMarquee } from "@/components/sections/CapabilityMarquee";
import { Solutions } from "@/components/sections/Solutions";
import { Knowledge } from "@/components/sections/Knowledge";
import { ClosingCta } from "@/components/sections/ClosingCta";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <WhoWeAre />
      <DesigningSequence />
      <Numbers />
      <Sustainability />
      <Foundation />
      <CapabilityMarquee />
      <Solutions />
      <Knowledge />
      <ClosingCta />
    </>
  );
}
