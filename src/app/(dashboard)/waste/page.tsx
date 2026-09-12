import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listIngredients } from "@/server/services/ingredient-service";
import { listWasteRecords } from "@/server/services/waste-service";
import { WasteClient } from "./waste-client";

export const metadata: Metadata = {
  title: "Waste — CaféOps",
};

export default async function WastePage() {
  const user = await requirePageAccess("inventory:waste");

  const [ingredients, records] = await Promise.all([
    listIngredients(db, user.businessId),
    listWasteRecords(db, user.businessId),
  ]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <WasteClient ingredients={ingredients} records={records} />
    </div>
  );
}
