import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listStaff } from "@/server/services/staff-service";
import { StaffClient } from "./staff-client";
import { ActionScopeProvider } from "@/components/action-scope";
import { actionScopeFor } from "@/lib/auth/action-scope";

export const metadata: Metadata = {
  title: "Staff — Café POS",
};

export default async function StaffPage() {
  const user = await requirePageAccess("staff:write");
  const staff = await listStaff(db, user.businessId);

  return (
    <ActionScopeProvider scope={actionScopeFor(user)}>
      <div className="mx-auto max-w-[1440px]">
        <StaffClient staff={staff} currentUserId={user.id} />
      </div>
    </ActionScopeProvider>
  );
}
