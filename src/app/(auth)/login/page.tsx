import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "./login-form";
import { QuickLoginPanel } from "./quick-login-panel";

export const metadata: Metadata = {
  title: "Sign in — CaféOps",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  return (
    <div className="force-light-theme flex min-h-screen flex-col items-center justify-center bg-[var(--color-page-bg)] px-6">
      <h1 className="mb-8 flex justify-center">
        <BrandLogo className="h-20" />
      </h1>
      <div className="w-full max-w-[380px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Sign in to continue.
        </p>
        <div className="mt-6">
          <LoginForm />
        </div>
        {process.env.NODE_ENV !== "production" ? <QuickLoginPanel /> : null}
      </div>
    </div>
  );
}
