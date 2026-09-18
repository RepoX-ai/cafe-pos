import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAccess } from "@/lib/auth/guards";
import { BrandLogo } from "@/components/brand-logo";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = {
  title: "Change password — CaféOps",
};

/**
 * Lives outside the (dashboard) group on purpose: a cashier-only account
 * is redirected away from every admin route, but their password is still
 * theirs to change. Any signed-in user may open this; the action re-checks.
 */
export default async function ChangePasswordPage() {
  const user = await requirePageAccess();

  return (
    <div className="force-light-theme flex min-h-screen flex-col items-center justify-center bg-[var(--color-page-bg)] px-6">
      <h1 className="mb-8 flex justify-center">
        <BrandLogo className="h-20" name={user.businessName} />
      </h1>
      <div className="w-full max-w-[380px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Change password</h2>
        <p className="mt-1 mb-6 text-sm text-[var(--color-text-secondary)]">
          Signed in as {user.email}. Any other device using your old password will be signed out.
        </p>
        <PasswordForm />
      </div>
      <Link href="/" className="mt-6 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        &larr; Back
      </Link>
    </div>
  );
}
