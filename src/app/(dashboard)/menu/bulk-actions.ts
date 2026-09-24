"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { ServiceError } from "@/server/services/errors";
import { applyMenuImport, parseMenuImportCsv } from "@/server/services/menu-bulk";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export type ImportMenuCsvResult =
  | { ok: true; summary: string }
  | { ok: false; error: string; rowErrors?: { row: number; message: string }[] };

/**
 * Bulk-updates the menu catalog from an uploaded CSV — same file shape the
 * export route (`/api/exports/menu`) produces, so "download, edit,
 * re-upload" is the intended loop. `menu:write` covers item/variant fields;
 * a file that also carries recipe lines additionally needs `recipes:write`,
 * checked only once the file is parsed and we actually know it does (the
 * server never trusts the UI's own gating for this, per the permission
 * model — see requirePermission's docstring).
 */
export async function importMenuCsvAction(
  _prev: ImportMenuCsvResult | undefined,
  formData: FormData,
): Promise<ImportMenuCsvResult> {
  const result = await asActionResult(async () => {
    const user = await requireCurrentUser();
    const ctx = { businessId: user.businessId, userId: user.id };
    requirePermission(user.roles, "menu:write");

    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) {
      throw new ServiceError("Too many changes in a short time. Wait a moment and try again.");
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a CSV file first." } as const;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return { ok: false, error: "File is too large (max 2 MB)." } as const;
    }

    const text = await file.text();
    const parsed = parseMenuImportCsv(text);
    if (!parsed.ok) return parsed;

    if (parsed.data.hasRecipeRows) requirePermission(user.roles, "recipes:write");

    const idempotencyKey = String(formData.get("idempotencyKey") ?? "") || undefined;
    const { result: counts, replayed } = await applyMenuImport(db, ctx, parsed.data, idempotencyKey);

    revalidatePath("/menu");
    invalidatePosMenuCache(ctx.businessId);

    return {
      ok: true,
      summary: replayed
        ? "This file was already imported — no changes made."
        : `${counts.itemsCreated} item(s) created, ${counts.itemsUpdated} updated, ${counts.variantsCreated} variant(s) created, ${counts.variantsUpdated} updated, ${counts.recipesReplaced} recipe(s) replaced.`,
    } as const;
  });
  return result as ImportMenuCsvResult;
}
