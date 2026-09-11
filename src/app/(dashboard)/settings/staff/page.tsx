import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listStaff } from "@/server/services/staff-service";
import { StaffClient } from "./staff-client";

export const metadata: Metadata = {
  title: "Staff — CaféOps",
};

export default async function StaffPage() {
  const user = await requirePageAccess("staff:write");
  const staff = await listStaff(db, user.businessId);

  return (
    <div className="mx-auto max-w-[900px] px-8 py-10">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        <ArrowLeft size={14} />
        Back to settings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">Staff</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Create accounts, assign roles, and deactivate staff who no longer work here.
      </p>

      <div className="mt-8">
        <StaffClient staff={staff} currentUserId={user.id} />
      </div>
    </div>
  );
}
