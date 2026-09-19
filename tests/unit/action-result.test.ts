import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/lib/permissions/permissions";
import {
  asActionResult,
  mapControlledActionError,
  PERMISSION_DENIED_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from "@/lib/permissions/action-result";

describe("mapControlledActionError", () => {
  it("maps PermissionDeniedError to a stable message without the permission name", () => {
    const mapped = mapControlledActionError(new PermissionDeniedError("staff:write"));
    expect(mapped).toEqual({ ok: false, error: PERMISSION_DENIED_MESSAGE });
    expect(mapped?.error).not.toMatch(/staff:write/);
  });

  it("maps requireCurrentUser's bare Not authenticated error", () => {
    expect(mapControlledActionError(new Error("Not authenticated"))).toEqual({
      ok: false,
      error: UNAUTHENTICATED_MESSAGE,
    });
  });

  it("leaves unrelated errors alone", () => {
    expect(mapControlledActionError(new Error("boom"))).toBeNull();
    expect(mapControlledActionError("string")).toBeNull();
  });
});

describe("asActionResult", () => {
  it("returns the action value on success", async () => {
    await expect(asActionResult(async () => ({ ok: true as const, id: 1 }))).resolves.toEqual({
      ok: true,
      id: 1,
    });
  });

  it("converts PermissionDeniedError into { ok: false }", async () => {
    await expect(
      asActionResult(async () => {
        throw new PermissionDeniedError("orders:cancel");
      }),
    ).resolves.toEqual({ ok: false, error: PERMISSION_DENIED_MESSAGE });
  });

  it("rethrows unexpected errors", async () => {
    await expect(
      asActionResult(async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
  });
});
