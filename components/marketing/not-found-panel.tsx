import Link from "next/link";

/** The 404 message: Next's default words in the site's type, under an Rx band. */
export function NotFoundPanel() {
  return (
    <div className="max-w-xl w-full mx-auto px-4 md:px-10 py-24 md:py-32">
      <p className="font-heading text-[7rem] md:text-[9rem] leading-[0.85] tracking-[-0.025em] text-ink">404</p>
      <div className="mt-6 border-t-[6px] border-rx pt-5">
        <h1 className="font-sans text-lg tracking-normal text-muted-foreground">This page could not be found.</h1>
      </div>
      <Link
        href="/"
        className="btn-depth mt-8 inline-flex h-11 items-center rounded-md bg-rx px-6 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
      >
        Back to home
      </Link>
    </div>
  );
}
