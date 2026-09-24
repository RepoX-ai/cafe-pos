import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function run(module, args) {
  const result = spawnSync(process.execPath, [require.resolve(module), ...args], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Use Node directly so Windows and Unix behave alike. A failed migration
// must stop deployment before Next builds against an outdated schema.
if (process.env.VERCEL === "1") run("tsx/cli", ["scripts/migrate.ts"]);
run("next/dist/bin/next", ["build", ...process.argv.slice(2)]);
