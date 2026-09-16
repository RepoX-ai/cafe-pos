"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { businessSettingsInputSchema } from "@/lib/validation/settings";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import { updateBusinessSettings } from "@/server/services/business-service";
import { getPrinterProvider } from "@/printing";

export type SettingsActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function updateSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "settings:write");

  const parsed = businessSettingsInputSchema.safeParse({
    name: formData.get("name"),
    receiptFooter: formData.get("receiptFooter"),
    orderNumberPrefix: formData.get("orderNumberPrefix"),
    taxEnabled: formData.get("taxEnabled") === "on",
    taxPercent: formData.get("taxPercent") || 0,
    taxInclusive: formData.get("taxInclusive") === "on",
    serviceChargeEnabled: formData.get("serviceChargeEnabled") === "on",
    serviceChargePercent: formData.get("serviceChargePercent") || 0,
    allowNegativeStock: formData.get("allowNegativeStock") === "on",
  });

  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  await updateBusinessSettings(db, { businessId: user.businessId, userId: user.id }, parsed.data);
  revalidatePath("/settings");
  return { ok: true };
}

export async function testPrinterConnectionAction(): Promise<{ connected: boolean; message?: string }> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "printer:manage");

  const provider = getPrinterProvider();
  return provider.testConnection();
}
