import { describe, expect, it } from "vitest";
import { hasPermission, requirePermission, PermissionDeniedError } from "@/lib/permissions/permissions";

describe("permissions", () => {
  it("grants super_admin and owner every permission", () => {
    expect(hasPermission("super_admin", "staff:write")).toBe(true);
    expect(hasPermission("owner", "settings:write")).toBe(true);
  });

  it("restricts cashier to the order-facing workflow", () => {
    expect(hasPermission("cashier", "orders:create")).toBe(true);
    expect(hasPermission("cashier", "orders:read_own")).toBe(true);
    // Cashiers can browse the full order list/detail for complaint lookup,
    // but this permission must never gate anything that renders COGS/
    // gross-profit/margin — that stays behind orders:read_all.
    expect(hasPermission("cashier", "orders:read_all_basic")).toBe(true);

    for (const denied of [
      "reports:read",
      "orders:read_all",
      // menu:read gates the /menu ADMIN section (recipe COGS/margins) —
      // a cashier must never hold it, even though the POS itself reads
      // the menu catalog (via its own orders:create page permission).
      "menu:read",
      "menu:write",
      "inventory:read",
      "inventory:adjust",
      "purchases:write",
      "expenses:write",
      "staff:write",
      "settings:write",
      "audit:read",
      "orders:cancel",
      "orders:refund",
    ] as const) {
      expect(hasPermission("cashier", denied)).toBe(false);
    }
  });

  it("grants cashier reprint by default (PRD §4 role matrix)", () => {
    // Cashiers reprint receipts themselves rather than waiting for a
    // manager. Reprinting never creates an order or moves stock.
    expect(hasPermission("cashier", "orders:reprint")).toBe(true);
    expect(hasPermission("cashier", "orders:reprint", { cashierCanReprintOwn: true })).toBe(true);
  });

  it("still keeps cashiers away from cancelling and refunding", () => {
    // Reprint is deliberately the only order-altering-looking capability a
    // cashier gained; money-affecting actions stay with managers.
    expect(hasPermission("cashier", "orders:cancel")).toBe(false);
    expect(hasPermission("cashier", "orders:refund")).toBe(false);
  });

  it("keeps manager away from staff and settings management", () => {
    expect(hasPermission("manager", "orders:create")).toBe(true);
    expect(hasPermission("manager", "purchases:write")).toBe(true);
    expect(hasPermission("manager", "staff:write")).toBe(false);
    expect(hasPermission("manager", "settings:write")).toBe(false);
  });

  it("gives inventory staff inventory/purchasing access but not orders by default", () => {
    expect(hasPermission("inventory_staff", "inventory:receive")).toBe(true);
    expect(hasPermission("inventory_staff", "purchases:write")).toBe(true);
    expect(hasPermission("inventory_staff", "orders:create")).toBe(false);
    // Same rationale as cashier: PRD's matrix says "Menu management" = No.
    expect(hasPermission("inventory_staff", "menu:read")).toBe(false);
    expect(
      hasPermission("inventory_staff", "orders:create", {
        inventoryStaffCanCreateOrders: true,
      }),
    ).toBe(true);
  });

  it("restricts viewer to read-only access", () => {
    expect(hasPermission("viewer", "reports:read")).toBe(true);
    expect(hasPermission("viewer", "inventory:read")).toBe(true);
    expect(hasPermission("viewer", "orders:create")).toBe(false);
    expect(hasPermission("viewer", "menu:write")).toBe(false);
    expect(hasPermission("viewer", "menu:read")).toBe(false);
  });

  it("requirePermission throws PermissionDeniedError when nothing matches", () => {
    expect(() => requirePermission(["cashier"], "reports:read")).toThrow(
      PermissionDeniedError,
    );
    expect(() => requirePermission(["owner"], "reports:read")).not.toThrow();
  });

  it("unions permissions across multiple roles held by one user", () => {
    expect(() => requirePermission(["cashier", "inventory_staff"], "purchases:write")).not.toThrow();
  });
});
