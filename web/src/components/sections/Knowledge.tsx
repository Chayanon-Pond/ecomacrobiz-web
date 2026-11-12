import { knowledge } from "@/content/home";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";

export function Knowledge() {
  return (
    <section
      aria-labelledby="knowledge-title"
      className="container-page py-[clamp(5rem,14vh,10rem)]"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div data-reveal>
          <p className="eyebrow mb-4">{knowledge.eyebrow}</p>
          <h2
            id="knowledge-title"
            className="display-tight text-[clamp(2.5rem,7vw,6rem)] font-bold"
          >
            {knowledge.title}
          </h2>
        </div>
        <div data-reveal>
          <MagneticButton href={knowledge.cta.href} variant="ghost">
            {knowledge.cta.label}
            <ArrowIcon />
          </MagneticButton>
        </div>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {knowledge.posts.map((post) => (
          <li key={post.slug} data-reveal className="flex">
            <SpotlightCard
              href={`/knowledge/${post.slug}`}
              className="group flex w-full flex-col justify-between gap-10 p-6 transition-[translate] duration-500 ease-out-expo hover:-translate-y-1 sm:p-7"
            >
              <p className="relative z-10 font-display text-[0.7rem] font-semibold tracking-[0.18em] text-accent-soft">
                {post.category}
              </p>
              <div className="relative z-10">
                <h3 className="thai-heading text-lg font-semibold text-fg">{post.title}</h3>
                <p className="mt-4 flex items-center justify-between text-sm text-subtle">
                  {post.readTime}
                  <ArrowIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </p>
              </div>
            </SpotlightCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
