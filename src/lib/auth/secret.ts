/**
 * AUTH_SECRET is the pepper for session-token HMAC. Without it (or with a
 * known placeholder) production must refuse to boot — a missing pepper
 * would remove the additional protection provided by a separate secret.
 * Session tokens are random; stored digests are never accepted as tokens.
 */

const WEAK_AUTH_SECRET_PLACEHOLDERS = new Set([
  "dev-only-not-for-production",
  "local-dev-only-auth-secret-min-32-chars-xx",
  "test-only-auth-secret-min-32-characters!",
  "unit-test-auth-secret-min-32-chars!!",
  "change-me-to-a-random-32-byte-secret",
  "change-me",
  "secret",
  "password",
  "postgres",
]);

const MIN_PRODUCTION_SECRET_LENGTH = 32;

export class AuthSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthSecretError";
  }
}

type EnvLike = { NODE_ENV?: string; AUTH_SECRET?: string };

function isProduction(env: EnvLike): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Validates AUTH_SECRET for the current environment. In production, missing,
 * short, or known-weak values throw. In non-production, the variable must
 * still be set (so local config matches reality) but weak placeholders used
 * only for DX are allowed.
 */
export function assertAuthSecretConfigured(env: EnvLike = process.env): string {
  const secret = env.AUTH_SECRET?.trim() ?? "";

  if (!secret) {
    throw new AuthSecretError(
      "AUTH_SECRET is required. Generate one with: openssl rand -base64 32",
    );
  }

  if (!isProduction(env)) {
    return secret;
  }

  if (WEAK_AUTH_SECRET_PLACEHOLDERS.has(secret)) {
    throw new AuthSecretError(
      "AUTH_SECRET equals a known insecure placeholder. Set a unique secret " +
        "(openssl rand -base64 32) before starting in production.",
    );
  }

  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new AuthSecretError(
      `AUTH_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`,
    );
  }

  return secret;
}

/** Returns the validated AUTH_SECRET (throws if misconfigured). */
export function getAuthSecret(env: EnvLike = process.env): string {
  return assertAuthSecretConfigured(env);
}


