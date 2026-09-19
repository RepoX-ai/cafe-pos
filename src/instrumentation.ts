/**
 * Next.js instrumentation hook — runs once when the Node server process
 * starts. Fail fast if AUTH_SECRET is missing/weak in production so we never
 * serve traffic that would hash sessions with a broken pepper.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertAuthSecretConfigured } = await import("@/lib/auth/secret");
    assertAuthSecretConfigured();
  }
}
