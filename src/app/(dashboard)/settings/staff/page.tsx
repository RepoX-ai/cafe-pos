import type { Metadata } from "next";
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
    <div className="mx-auto max-w-[1440px]">
      <StaffClient staff={staff} currentUserId={user.id} />
    </div>
  );
}
