import { describe, expect, it, vi } from "vitest";
import { warnIfTrustedClientIpUnset } from "@/lib/http/trusted-ip-warning";

describe("warnIfTrustedClientIpUnset", () => {
  it("does nothing outside production", () => {
    const log = vi.fn();
    warnIfTrustedClientIpUnset({ NODE_ENV: "development" }, log);
    expect(log).not.toHaveBeenCalled();
  });

  it("warns in production when neither trusted-IP setting is present", () => {
    const log = vi.fn();
    warnIfTrustedClientIpUnset({ NODE_ENV: "production" }, log);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toMatch(/TRUSTED_CLIENT_IP_HEADER|TRUSTED_PROXY_COUNT/);
  });

  it("stays quiet when a trusted header or proxy count is configured", () => {
    const log = vi.fn();
    warnIfTrustedClientIpUnset(
      { NODE_ENV: "production", TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for" },
      log,
    );
    warnIfTrustedClientIpUnset({ NODE_ENV: "production", TRUSTED_PROXY_COUNT: "1" }, log);
    expect(log).not.toHaveBeenCalled();
  });
});
