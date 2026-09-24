import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    const resolved = path.resolve(fixture);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("cafe-build-test-")) {
      throw new Error("Refusing to remove a path outside the build test fixtures");
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

function build(env: Record<string, string>) {
  const fixture = mkdtempSync(path.join(tmpdir(), "cafe-build-test-"));
  fixtures.push(fixture);
  mkdirSync(path.join(fixture, "scripts"));
  copyFileSync(path.resolve("scripts/build.mjs"), path.join(fixture, "scripts/build.mjs"));
  for (const [name, entry, output, exitVariable] of [
    ["tsx", "cli", "migrate", "MIGRATION_EXIT"],
    ["next", "dist/bin/next", "build", "BUILD_EXIT"],
  ]) {
    const directory = path.join(fixture, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({
      name, exports: { [`./${entry}`]: "./cli.cjs" },
    }));
    writeFileSync(path.join(directory, "cli.cjs"),
      `console.log('${output}'); process.exit(Number(process.env.${exitVariable} || 0));`);
  }
  return spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: fixture, encoding: "utf8",
    env: { ...process.env, VERCEL: "", MIGRATION_EXIT: "0", BUILD_EXIT: "0", ...env },
  });
}

describe("production build runner", () => {
  it("builds locally without running migrations", () => {
    const result = build({});
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("build");
  });
  it("migrates before building on Vercel", () => {
    const result = build({ VERCEL: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(["migrate", "build"]);
  });
  it("stops deployment when migrations fail", () => {
    const result = build({ VERCEL: "1", MIGRATION_EXIT: "7" });
    expect(result.status).toBe(7);
    expect(result.stdout.trim()).toBe("migrate");
  });
  it("propagates a failed Next build", () => {
    expect(build({ BUILD_EXIT: "3" }).status).toBe(3);
  });
});
