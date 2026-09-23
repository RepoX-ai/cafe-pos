"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { toUserMessage } from "@/server/services/errors";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { businessSettingsInputSchema } from "@/lib/validation/settings";
import { brandingInputSchema, createBusinessInputSchema } from "@/lib/validation/business";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import { createBusiness, updateBranding, updateBusinessSettings } from "@/server/services/business-service";
import { saveBusinessLogo } from "@/server/services/menu-image-upload";
import { getPrinterProvider } from "@/printing";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

export type SettingsActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function updateSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  return asActionResult(async () => {
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
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    await updateBusinessSettings(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    revalidatePath("/settings");
    // Stock gating on POS depends on allowNegativeStock.
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}


export async function testPrinterConnectionAction(): Promise<{ connected: boolean; message?: string }> {
  const result = await asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "printer:manage");

    const provider = getPrinterProvider();
    return provider.testConnection();
  });
  if (result && typeof result === "object" && "ok" in result && (result as { ok: boolean }).ok === false) {
    return { connected: false, message: (result as { error: string }).error };
  }
  return result as { connected: boolean; message?: string };
}

export type CreateBusinessResult =
  | { ok: true; businessName: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Stands up a new tenant with the caller as its Owner.
 *
 * Gated on `business:create`, which only owner and super_admin hold — a
 * manager with `settings:write` can edit the café they're in but cannot
 * create another one. The caller's own id comes from the session, so the
 * new business's owner is always the person who clicked, never an id the
 * form supplied.
 */
export async function createBusinessAction(input: unknown): Promise<CreateBusinessResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "business:create");

    const parsed = createBusinessInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.createBusiness(), user))) {
      return { ok: false, error: "Too many new businesses in a short time. Try again later." };
    }

    try {
      await createBusiness(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    } catch (error) {
      return { ok: false, error: toUserMessage(error, "dashboard/settings") };
    }

    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true, businessName: parsed.data.name };
  });
}


export type BrandingResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Saves the current business's logo and accent colour.
 *
 * The logo file is stored under this business's own folder, and the 1-bit
 * receipt raster that the browser produced from the same file is saved
 * with it — see `src/lib/branding/raster-browser.ts` for why that happens
 * client-side.
 */
export async function updateBrandingAction(formData: FormData): Promise<BrandingResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "settings:write");

    const parsed = brandingInputSchema.safeParse({
      brandColor: formData.get("brandColor") || "",
      logoRasterBase64: formData.get("logoRasterBase64") || "",
      logoRasterWidth: formData.get("logoRasterWidth") || undefined,
      logoRasterHeight: formData.get("logoRasterHeight") || undefined,
      removeLogo: formData.get("removeLogo") === "on",
    });
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }

    let logoUrl: string | null = null;
    const file = formData.get("logoFile");
    if (file instanceof File && file.size > 0) {
      if (!(await allowUserAction(db, RATE_LIMITS.upload(), user))) {
        return { ok: false, error: "Too many logo uploads. Wait a few minutes and try again." };
      }
      const saved = await saveBusinessLogo(file, user.businessId);
      if (!saved.ok) return { ok: false, error: saved.error, fieldErrors: { logoFile: saved.error } };
      logoUrl = saved.url;
    }

    await updateBranding(db, { businessId: user.businessId, userId: user.id }, { ...parsed.data, logoUrl });

    // The logo and accent live in the shell, not just this page.
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { ok: true };
  });
}

