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
    <div className="mx-auto max-w-[1000px] px-8 py-10">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Waste</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Record spoilage and preparation waste. Estimated cost uses each ingredient&apos;s current average cost.
      </p>

      <div className="mt-8">
        <WasteClient ingredients={ingredients} records={records} />
      </div>
    </div>
  );
}
