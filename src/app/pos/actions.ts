"use server";

import { after } from "next/server";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { submitOrderForUser, type SubmitOrderResult } from "@/server/services/checkout";
import { claimRateLimitCleanupSlot, deleteExpiredRateLimitBuckets } from "@/server/services/rate-limit";

export type { SubmitOrderResult };

export async function submitOrderAction(input: unknown): Promise<SubmitOrderResult> {
  const user = await requireCurrentUser();
  const result = await submitOrderForUser(db, user, input);
  if (claimRateLimitCleanupSlot()) after(() => deleteExpiredRateLimitBuckets(db).catch(() => undefined));
  return result;
}
