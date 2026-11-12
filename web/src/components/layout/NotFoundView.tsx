import Link from "next/link";

export function NotFoundView() {
  return (
    <section className="container-page flex min-h-[80svh] flex-col justify-center gap-6 pt-[var(--header-h)]">
      <p className="eyebrow">404</p>
      <h1 className="display-tight text-[clamp(3rem,10vw,8rem)] font-bold">Page not found</h1>
      <p className="text-muted">ไม่พบหน้าที่คุณต้องการ</p>
      <Link
        href="/"
        className="inline-flex min-h-12 w-fit items-center rounded-full bg-accent px-6 font-medium text-white"
      >
        กลับหน้าแรก
      </Link>
    </section>
  );
}
