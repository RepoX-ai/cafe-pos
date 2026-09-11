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
    expect(hasPermission("cashier", "menu:read")).toBe(true);

    for (const denied of [
      "reports:read",
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

  it("does not grant cashier reprint by default, but does with the override", () => {
    expect(hasPermission("cashier", "orders:reprint")).toBe(false);
    expect(
      hasPermission("cashier", "orders:reprint", { cashierCanReprintOwn: true }),
    ).toBe(true);
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
