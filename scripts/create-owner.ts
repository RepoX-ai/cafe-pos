import "dotenv/config";
import readline from "node:readline";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { DEV_SEED_PASSWORD } from "../src/lib/dev-seed-accounts";

/**
 * Creates a business and its owner account.
 *
 * `npm run db:seed` deliberately refuses to run against production — it
 * creates accounts behind a password that is public in this repo's
 * history — and staff accounts can otherwise only be created from inside
 * an authenticated session. That leaves a freshly migrated production
 * database with no way to log in at all. This script is that way in, and
 * it is the only seeding path safe to point at real data: every value
 * comes from the operator, nothing is fictional, and no password is
 * written into the repo.
 *
 * Also the way to add the second and subsequent cafes: businesses are
 * independent tenants, so this can be run again against the same
 * database. If the owner email already has a CafeOps account it is linked
 * to the new business rather than duplicated -- one person, one login, one
 * password, an owner membership per cafe. Their existing password stands
 * and OWNER_PASSWORD is ignored in that case.
 *
 * Interactive by default. For a non-TTY (CI, `docker compose run`), set
 * OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME / BUSINESS_NAME /
 * ORDER_PREFIX instead and it runs unattended.
 */

const MIN_PASSWORD_LENGTH = 12;

function ask(rl: readline.Interface, query: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  return new Promise((resolve) => {
    rl.question(`${query}${suffix}: `, (answer) => resolve(answer.trim() || fallback || ""));
  });
}

/**
 * Same as `ask`, but masks the typed characters so the password does not
 * sit in the operator's terminal scrollback.
 */
function askHidden(rl: readline.Interface, query: string): Promise<string> {
  const prompt = `${query}: `;
  const iface = rl as unknown as {
    _writeToOutput?: (s: string) => void;
    output: NodeJS.WritableStream;
  };
  const original = iface._writeToOutput;
  return new Promise((resolve) => {
    iface._writeToOutput = (stringToWrite: string) => {
      iface.output.write(stringToWrite.includes(prompt) ? prompt : "*");
    };
    rl.question(prompt, (answer) => {
      iface._writeToOutput = original;
      iface.output.write("\n");
      resolve(answer);
    });
  });
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail("DATABASE_URL is not set.");

  const interactive = process.stdin.isTTY === true;
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  // Env vars win over prompts, so a half-configured non-TTY run fails
  // loudly here rather than hanging on a prompt nobody can answer.
  let businessName = process.env.BUSINESS_NAME ?? "";
  let orderPrefix = process.env.ORDER_PREFIX ?? "";
  let ownerName = process.env.OWNER_NAME ?? "";
  let email = process.env.OWNER_EMAIL ?? "";
  let password = process.env.OWNER_PASSWORD ?? "";

  if (rl) {
    console.log("\n  Create a business and its owner account.\n");
    businessName = businessName || (await ask(rl, "  Business name"));
    orderPrefix = orderPrefix || (await ask(rl, "  Order number prefix", "ORD"));
    ownerName = ownerName || (await ask(rl, "  Owner full name"));
    email = email || (await ask(rl, "  Owner email"));
    if (!password) {
      password = await askHidden(rl, "  Owner password");
      const confirm = await askHidden(rl, "  Confirm password");
      if (password !== confirm) {
        rl.close();
        fail("Passwords did not match. Nothing was written.");
      }
    }
    rl.close();
  }

  email = email.trim().toLowerCase();

  if (!businessName) fail("Business name is required (BUSINESS_NAME).");
  if (!ownerName) fail("Owner name is required (OWNER_NAME).");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`Not a valid email address: ${email || "(empty)"}`);
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}).`);
  }
  // The dev seed password happens to be exactly MIN_PASSWORD_LENGTH long,
  // so the length check alone would wave it through — and it is public in
  // this repo's history, which makes it the one password that must never
  // reach a real deployment.
  if (password === DEV_SEED_PASSWORD) {
    fail("That is the development seed password, which is public in this repo's history. Choose a different one.");
  }
  orderPrefix = (orderPrefix || "ORD").toUpperCase();

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    // An existing account is linked, not rejected: the same person owning
    // two cafes is the ordinary case now, and duplicating them would leave
    // them with two logins and two passwords to keep straight.
    const [existingUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    const passwordHash = existingUser ? null : await hashPassword(password);

    // One transaction: a half-created owner (business but no user, or a
    // user with no role) would leave the app unreachable in a way that is
    // awkward to unpick by hand.
    const result = await db.transaction(async (tx) => {
      const [business] = await tx
        .insert(schema.businesses)
        .values({
          name: businessName,
          currency: "IDR",
          timezone: process.env.BUSINESS_TIMEZONE || "Asia/Jakarta",
          orderNumberPrefix: orderPrefix,
        })
        .returning();

      await tx.insert(schema.locations).values({ businessId: business.id, name: "Main Store" });

      // Global catalog, shared by every business — insert-if-missing so
      // this is safe on a database that has already been seeded.
      const roleNames = ["super_admin", "owner", "manager", "cashier", "inventory_staff", "viewer"] as const;
      await tx
        .insert(schema.roles)
        .values(roleNames.map((name) => ({ name })))
        .onConflictDoNothing({ target: schema.roles.name });

      const [ownerRole] = await tx
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "owner"))
        .limit(1);
      if (!ownerRole) throw new Error("The 'owner' role is missing from the roles catalog.");

      const [user] = existingUser
        ? (await tx.select().from(schema.users).where(eq(schema.users.id, existingUser.id)).limit(1))
        : await tx
            .insert(schema.users)
            .values({ name: ownerName, email, passwordHash: passwordHash! })
            .returning();

      const [membership] = await tx
        .insert(schema.memberships)
        .values({ userId: user.id, businessId: business.id })
        .returning();

      await tx.insert(schema.membershipRoles).values({ membershipId: membership.id, roleId: ownerRole.id });

      return { business, user, linked: Boolean(existingUser) };
    });

    console.log(`\n  Created business "${result.business.name}" (${result.business.id})`);
    if (result.linked) {
      console.log(`  Linked owner    ${result.user.email} (${result.user.id}) - existing account and password`);
      console.log(`\n  They pick it from the business switcher after signing in.\n`);
    } else {
      console.log(`  Created owner   ${result.user.email} (${result.user.id})`);
      console.log(`\n  You can now sign in at /login with that email.\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\n  Failed to create owner:", error instanceof Error ? error.message : error);
  process.exit(1);
});
