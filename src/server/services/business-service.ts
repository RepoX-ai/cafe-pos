import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { businesses } from "@/lib/db/schema";

export async function getBusinessById(db: Database, businessId: string) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return business ?? null;
}
