import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { LockHolder, track } from "./concurrency-helpers";
import { saveRecipe } from "@/server/services/recipe-service";
import {
  createMenuItem,
  createModifierGroup,
  createModifierOption,
  saveModifierOptionRecipe,
  setItemModifierGroups,
} from "@/server/services/menu-service";

const dbA = getTestDb();
const dbB = getTestDb();
const holderDb = getTestDb();

afterAll(async () => {
  await Promise.all([dbA?.$client.end(), dbB?.$client.end(), holderDb?.$client.end()]);
});

async function extraIngredient(businessId: string) {
  const [row] = await dbA!
    .insert(schema.ingredients)
    .values({ businessId, name: `Milk ${randomUUID()}`, baseUnit: "millilitre", currentQuantityBaseUnits: "1000", averageCostPerBaseUnit: "1" })
    .returning();
  return row;
}

describe.skipIf(!dbA)("recipe versioning under concurrency (PostgreSQL)", () => {
  it("gives concurrent first saves distinct versions and exactly one active recipe", async () => {
    const f = await seedTestFixture(dbA!);
    const actor = { businessId: f.business.id, userId: f.user.id };
    // A brand-new item: its default variant has no recipe row yet to lock.
    const item = await createMenuItem(dbA!, actor, {
      name: `Fresh ${randomUUID().slice(0, 6)}`, basePrice: 1000, taxBehavior: "exclusive", tracksInventory: true, active: true, displayOrder: 0,
    });
    const [variant] = await dbA!.select().from(schema.menuItemVariants).where(eq(schema.menuItemVariants.menuItemId, item.id));

    const holder = await LockHolder.begin(holderDb!.$client);
    await holder.query("select id from menu_item_variants where id = $1 for update", [variant.id]);
    const saves = Array.from({ length: 6 }, (_, i) =>
      track(
        saveRecipe(i % 2 ? dbB! : dbA!, actor, {
          menuItemVariantId: variant.id,
          lines: [{ ingredientId: f.ingredient.id, quantityBaseUnits: i + 1, wastePercentage: 0 }],
        }),
      ),
    );
    await holder.waitForBlocked(6);
    await holder.commit();
    const results = await Promise.allSettled(saves.map((s) => s.promise));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const rows = await dbA!.select().from(schema.recipes).where(eq(schema.recipes.menuItemVariantId, variant.id));
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.filter((r) => r.active)).toHaveLength(1);
    expect(rows.find((r) => r.active)!.version).toBe(6);
  });

  it("rejects a second active recipe or a repeated version at the database", async () => {
    const f = await seedTestFixture(dbA!);
    const [existing] = await dbA!.select().from(schema.recipes).where(eq(schema.recipes.menuItemVariantId, f.variant.id));
    const unique = (constraint: string) => expect.objectContaining({ cause: expect.objectContaining({ code: "23505", constraint }) });
    await expect(
      dbA!.insert(schema.recipes).values({ businessId: f.business.id, menuItemVariantId: f.variant.id, version: existing.version + 1, active: true }),
    ).rejects.toEqual(unique("recipes_one_active_per_variant_idx"));
    await expect(
      dbA!.insert(schema.recipes).values({ businessId: f.business.id, menuItemVariantId: f.variant.id, version: existing.version, active: false }),
    ).rejects.toEqual(unique("recipes_variant_version_idx"));
  });

  it("replaces a modifier option's lines with exactly one of two concurrent saves", async () => {
    const f = await seedTestFixture(dbA!);
    const actor = { businessId: f.business.id, userId: f.user.id };
    const milk = await extraIngredient(f.business.id);
    const group = await createModifierGroup(dbA!, actor, { name: "Extras", required: false, minSelections: 0, maxSelections: 1 });
    const option = await createModifierOption(dbA!, actor, group.id, { name: "Latte art", priceAdjustment: 0, active: true, displayOrder: 0 });

    const holder = await LockHolder.begin(holderDb!.$client);
    await holder.query("select id from modifier_options where id = $1 for update", [option.id]);
    const one = track(saveModifierOptionRecipe(dbA!, actor, { groupId: group.id, optionId: option.id, lines: [{ ingredientId: f.ingredient.id, quantityBaseUnits: 5, wastePercentage: 0 }] }));
    const two = track(saveModifierOptionRecipe(dbB!, actor, { groupId: group.id, optionId: option.id, lines: [{ ingredientId: milk.id, quantityBaseUnits: 30, wastePercentage: 0 }] }));
    await holder.waitForBlocked(2);
    await holder.commit();
    await Promise.all([one.promise, two.promise]);

    const lines = await dbA!.select().from(schema.modifierRecipeLines).where(eq(schema.modifierRecipeLines.modifierOptionId, option.id));
    // Not the union of both saves — that would double every sale's consumption.
    expect(lines).toHaveLength(1);
  });

  it("serializes concurrent modifier-group assignments for one item", async () => {
    const f = await seedTestFixture(dbA!);
    const actor = { businessId: f.business.id, userId: f.user.id };
    const g1 = await createModifierGroup(dbA!, actor, { name: "Size", required: false, minSelections: 0, maxSelections: 1 });
    const g2 = await createModifierGroup(dbA!, actor, { name: "Milk", required: false, minSelections: 0, maxSelections: 1 });

    const holder = await LockHolder.begin(holderDb!.$client);
    await holder.query("select id from menu_items where id = $1 for update", [f.menuItem.id]);
    const one = track(setItemModifierGroups(dbA!, actor, f.menuItem.id, [g1.id]));
    const two = track(setItemModifierGroups(dbB!, actor, f.menuItem.id, [g2.id, g1.id]));
    await holder.waitForBlocked(2);
    await holder.commit();
    await Promise.all([one.promise, two.promise]);

    const rows = await dbA!
      .select()
      .from(schema.menuItemModifierGroups)
      .where(and(eq(schema.menuItemModifierGroups.menuItemId, f.menuItem.id), eq(schema.menuItemModifierGroups.businessId, f.business.id)));
    const ids = rows.map((r) => r.modifierGroupId).sort();
    expect([[g1.id], [g1.id, g2.id].sort()]).toContainEqual(ids);
  });
});
