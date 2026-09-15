import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clientIpConfigFromEnv, resolveClientIp } from "@/lib/http/client-ip";
import { ORDER_LIMITS, submitOrderInputSchema } from "@/lib/validation/order";

const headersOf = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe("trusted client IP", () => {
  it("trusts no forwarding header unless a proxy is configured", () => {
    expect(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "203.0.113.5" }), {})).toBeNull();
  });

  it("reads a single-address header the edge overwrites, and rejects a spoofed list", () => {
    const config = clientIpConfigFromEnv({ TRUSTED_CLIENT_IP_HEADER: "X-Real-IP" });
    expect(resolveClientIp(headersOf({ "x-real-ip": "203.0.113.5" }), config)).toBe("203.0.113.5");
    expect(resolveClientIp(headersOf({ "x-real-ip": "6.6.6.6, 203.0.113.5" }), config)).toBeNull();
    expect(resolveClientIp(headersOf({ "x-real-ip": "not-an-ip" }), config)).toBeNull();
  });

  it("takes the address appended by the outermost trusted proxy, ignoring client-supplied entries", () => {
    const oneProxy = clientIpConfigFromEnv({ TRUSTED_PROXY_COUNT: "1" });
    expect(resolveClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" }), oneProxy)).toBe("203.0.113.5");
    const twoProxies = clientIpConfigFromEnv({ TRUSTED_PROXY_COUNT: "2" });
    expect(resolveClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.5, 10.0.0.2" }), twoProxies)).toBe("203.0.113.5");
    expect(resolveClientIp(headersOf({ "x-forwarded-for": "203.0.113.5" }), twoProxies)).toBeNull();
  });

  it("ignores malformed proxy settings", () => {
    expect(clientIpConfigFromEnv({ TRUSTED_PROXY_COUNT: "abc" })).toEqual({ header: undefined, proxyCount: undefined });
  });
});

describe("checkout payload bounds", () => {
  const line = () => ({ menuItemId: randomUUID(), menuItemVariantId: randomUUID(), quantity: 1, modifierOptionIds: [] as string[] });
  const order = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    orderType: "dine_in",
    discountTotal: 0,
    lines: [line()],
    ...overrides,
  });
  const firstIssue = (input: unknown) => {
    const result = submitOrderInputSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("accepts a normal order at the limits", () => {
    expect(firstIssue(order({ lines: Array.from({ length: ORDER_LIMITS.maxLines }, line) }))).toBeNull();
    expect(firstIssue(order({ lines: [{ ...line(), quantity: ORDER_LIMITS.maxQuantityPerLine }] }))).toBeNull();
  });

  it("rejects too many lines, units, or modifiers", () => {
    expect(firstIssue(order({ lines: Array.from({ length: ORDER_LIMITS.maxLines + 1 }, line) }))).toMatch(/at most 100 lines/);
    expect(firstIssue(order({ lines: [{ ...line(), quantity: ORDER_LIMITS.maxQuantityPerLine + 1 }] }))).toMatch(/at most 999 units/);
    const tooMany = Array.from({ length: ORDER_LIMITS.maxModifiersPerLine + 1 }, () => randomUUID());
    expect(firstIssue(order({ lines: [{ ...line(), modifierOptionIds: tooMany }] }))).toMatch(/Too many modifiers/);
  });

  it("rejects the same modifier twice on one line", () => {
    const id = randomUUID();
    expect(firstIssue(order({ lines: [{ ...line(), modifierOptionIds: [id, id] }] }))).toMatch(/only be selected once/);
  });

  it("bounds strings and money", () => {
    expect(firstIssue(order({ notes: "x".repeat(1001) }))).not.toBeNull();
    expect(firstIssue(order({ lines: [{ ...line(), notes: "x".repeat(501) }] }))).not.toBeNull();
    expect(firstIssue(order({ discountTotal: ORDER_LIMITS.maxRupiah + 1 }))).not.toBeNull();
    expect(firstIssue(order({ idempotencyKey: "k".repeat(201) }))).not.toBeNull();
  });
});
