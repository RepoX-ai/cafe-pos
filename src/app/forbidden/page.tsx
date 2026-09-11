import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Access denied — CaféOps",
};

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-page-bg)] px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-[var(--color-danger)]">
        403
      </p>
      <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
        You don&apos;t have access to this page
      </h1>
      <p className="max-w-sm text-sm text-[var(--color-text-secondary)]">
        If you believe this is a mistake, ask an owner or manager to review your role.
      </p>
      <Link
        href="/"
        className="mt-2 text-sm font-medium text-[var(--color-accent-primary)] hover:underline"
      >
        Back to CaféOps
      </Link>
    </div>
  );
}
