import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { pageWindow, parsePageParam, toPage } from "@/lib/pagination";
import { ServerPagination } from "@/components/ui/server-pagination";
import { listIngredients } from "@/server/services/ingredient-service";
import { listWasteRecords } from "@/server/services/waste-service";
import { WasteClient } from "./waste-client";

export const metadata: Metadata = {
  title: "Waste — CaféOps",
};

export default async function WastePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requirePageAccess("inventory:waste");
  const window = pageWindow(parsePageParam((await searchParams).page));

  const [ingredients, rows] = await Promise.all([
    listIngredients(db, user.businessId),
    listWasteRecords(db, user.businessId, window),
  ]);
  const records = toPage(rows, window.page, window.pageSize);

  return (
    <div className="mx-auto max-w-[1440px]">
      <WasteClient
        ingredients={ingredients}
        records={records.rows}
        pagination={<ServerPagination page={{ ...records, rowCount: records.rows.length }} basePath="/waste" />}
      />
    </div>
  );
}
