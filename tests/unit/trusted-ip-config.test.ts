import { describe, expect, it } from "vitest";
import { assertTrustedClientIpConfig, TrustedClientIpConfigError } from "@/lib/http/trusted-ip-config";

const prod = (extra: Record<string, string>) => ({ NODE_ENV: "production", ...extra });

describe("assertTrustedClientIpConfig", () => {
  it("does nothing outside production", () => {
    expect(() => assertTrustedClientIpConfig({ NODE_ENV: "development" })).not.toThrow();
  });

  it("refuses to start production with no client-IP source", () => {
    expect(() => assertTrustedClientIpConfig({ NODE_ENV: "production" })).toThrow(TrustedClientIpConfigError);
  });

  it("accepts exactly one well-formed source", () => {
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_PROXY_COUNT: "1" }))).not.toThrow();
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_CLIENT_IP_HEADER: "X-Real-IP" }))).not.toThrow();
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_CLIENT_IP_NONE: "1" }))).not.toThrow();
  });

  it("refuses malformed values instead of silently ignoring them", () => {
    for (const bad of ["0", "abc", "1.5", "-1", "10"]) {
      expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_PROXY_COUNT: bad }))).toThrow(TrustedClientIpConfigError);
    }
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_CLIENT_IP_HEADER: "x-real-ipp" }))).toThrow(/not a recognised/);
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_CLIENT_IP_HEADER: "x real ip" }))).toThrow(TrustedClientIpConfigError);
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_CLIENT_IP_NONE: "true" }))).toThrow(TrustedClientIpConfigError);
  });

  it("refuses an ambiguous configuration", () => {
    expect(() => assertTrustedClientIpConfig(prod({ TRUSTED_PROXY_COUNT: "1", TRUSTED_CLIENT_IP_HEADER: "x-real-ip" }))).toThrow(/only one/);
  });
});
