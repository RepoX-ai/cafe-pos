import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { businesses, locations, membershipRoles, memberships, roles } from "@/lib/db/schema";
import { serializeTaxConfig } from "@/lib/settings/tax";
import type { BusinessSettingsInput } from "@/lib/validation/settings";
import type { BrandingInput, CreateBusinessInput } from "@/lib/validation/business";
import { normalizeHexColor } from "@/lib/branding/branding";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export async function getBusinessById(db: Database, businessId: string) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return business ?? null;
}

export async function updateBusinessSettings(
  db: Database,
  actor: ActorContext,
  input: BusinessSettingsInput,
) {
  const before = await getBusinessById(db, actor.businessId);

  const [row] = await db
    .update(businesses)
    .set({
      name: input.name,
      receiptFooter: input.receiptFooter || null,
      orderNumberPrefix: input.orderNumberPrefix,
      taxConfig: input.taxEnabled
        ? serializeTaxConfig({ percent: input.taxPercent, inclusive: input.taxInclusive })
        : null,
      serviceChargePercent: input.serviceChargeEnabled ? String(input.serviceChargePercent) : null,
      allowNegativeStock: input.allowNegativeStock,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, actor.businessId))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "settings.updated",
    entityType: "business",
    entityId: actor.businessId,
    before,
    after: row,
  });

  return row;
}

export interface OwnedBusinessRow {
  businessId: string;
  membershipId: string;
  name: string;
  orderNumberPrefix: string;
  isCurrent: boolean;
}

/**
 * The businesses this person can act in, for the "your businesses" list on
 * the settings screen. Scoped to their own memberships — there is no query
 * anywhere that lists businesses they don't belong to.
 */
export async function listOwnedBusinesses(
  db: Database,
  userId: string,
  currentBusinessId: string,
): Promise<OwnedBusinessRow[]> {
  const rows = await db
    .select({
      businessId: businesses.id,
      membershipId: memberships.id,
      name: businesses.name,
      orderNumberPrefix: businesses.orderNumberPrefix,
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
    .orderBy(asc(businesses.name));

  return rows.map((row) => ({ ...row, isCurrent: row.businessId === currentBusinessId }));
}

/**
 * Stands up a new tenant and makes the caller its Owner — the in-app
 * equivalent of `npm run db:create-owner`, so the client can open another
 * café without shell access to the server.
 *
 * The new business starts empty: no menu, no ingredients, no recipes, and
 * no staff but the creator. Businesses are independent tenants, so nothing
 * is copied or linked from the café the caller is currently in.
 *
 * Business, its default location, the caller's membership and that
 * membership's Owner role all land in one transaction — a half-created
 * business with no owner would be unreachable from the UI and need
 * unpicking by hand.
 */
export async function createBusiness(
  db: Database,
  actor: ActorContext,
  input: CreateBusinessInput,
): Promise<{ businessId: string; membershipId: string }> {
  const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner")).limit(1);
  if (!ownerRole) {
    throw new Error("The 'owner' role is missing from the roles catalog. Run the seed script.");
  }

  return db.transaction(async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({ name: input.name, orderNumberPrefix: input.orderNumberPrefix })
      .returning();

    await tx.insert(locations).values({ businessId: business.id, name: "Main Store" });

    const [membership] = await tx
      .insert(memberships)
      .values({ userId: actor.userId, businessId: business.id })
      .returning();

    await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId: ownerRole.id });

    // Logged in both places on purpose: the new business needs a first
    // entry saying who created it, and the business the action was taken
    // from needs a record that its owner stood up another tenant.
    await recordAuditLog(tx, {
      businessId: business.id,
      actorUserId: actor.userId,
      action: "business.created",
      entityType: "business",
      entityId: business.id,
      after: { name: business.name, orderNumberPrefix: business.orderNumberPrefix },
    });
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "business.created",
      entityType: "business",
      entityId: business.id,
      after: { name: business.name },
    });

    return { businessId: business.id, membershipId: membership.id };
  });
}

/**
 * Saves the business's visual identity: the accent colour, the logo shown
 * on screen, and the 1-bit copy of that logo the thermal printer uses.
 *
 * The screen logo and the receipt raster are written together or not at
 * all, so a receipt can never print last month's logo next to this
 * month's on screen. Clearing the logo clears both.
 */
export async function updateBranding(
  db: Database,
  actor: ActorContext,
  input: BrandingInput & { logoUrl?: string | null },
) {
  const before = await getBusinessById(db, actor.businessId);

  const clearing = input.removeLogo;
  const hasNewLogo = Boolean(input.logoUrl);
  const hasRaster = Boolean(input.logoRasterBase64 && input.logoRasterWidth && input.logoRasterHeight);

  const [row] = await db
    .update(businesses)
    .set({
      brandColor: normalizeHexColor(input.brandColor ?? null),
      ...(clearing
        ? { logoUrl: null, logoRasterBase64: null, logoRasterWidth: null, logoRasterHeight: null }
        : hasNewLogo
          ? {
              logoUrl: input.logoUrl,
              // A browser too old to rasterise still gets the on-screen
              // logo; the receipt simply keeps printing the name.
              logoRasterBase64: hasRaster ? input.logoRasterBase64 : null,
              logoRasterWidth: hasRaster ? input.logoRasterWidth : null,
              logoRasterHeight: hasRaster ? input.logoRasterHeight : null,
            }
          : {}),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, actor.businessId))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "branding.updated",
    entityType: "business",
    entityId: actor.businessId,
    before: { brandColor: before?.brandColor ?? null, logoUrl: before?.logoUrl ?? null },
    after: { brandColor: row.brandColor, logoUrl: row.logoUrl },
  });

  return row;
}
