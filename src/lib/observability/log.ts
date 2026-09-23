/**
 * Structured JSON-lines logging to stdout/stderr — what `docker compose
 * logs` or any log shipper collects. One line per event, `event` names the
 * kind, and the remaining fields are the context.
 *
 * Never pass secrets, passwords, session tokens, raw emails, IP addresses,
 * SQL parameters or request payloads as fields: `redactFields` strips the
 * obvious keys as a backstop, but callers are responsible for what they log.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|hash|dsn|params|email|^ip/i;
const MAX_STRING = 500;

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = typeof value === "string" && value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  return out;
}

function enabled(level: Level): boolean {
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return false;
  return level !== "debug" || process.env.LOG_LEVEL === "debug";
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (!enabled(level)) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redactFields(fields) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** Name, message and the pg error code/constraint — never the query text or its parameters. */
export function describeError(error: unknown): Record<string, unknown> {
  const chain: Array<{ name?: string; code?: string; constraint?: string }> = [];
  for (let current = error as { name?: string; code?: string; constraint?: string; cause?: unknown } | undefined; current && chain.length < 5; current = current.cause as typeof current) {
    chain.push({ name: current.name, code: current.code, constraint: current.constraint });
  }
  const top = error instanceof Error ? error : undefined;
  // Drizzle puts "Failed query: <sql> params: <values>" in the message.
  const message = top?.message && !/^Failed query/.test(top.message) ? top.message : undefined;
  const pg = chain.find((entry) => entry.code);
  return { errorName: top?.name ?? typeof error, errorMessage: message, pgCode: pg?.code, pgConstraint: pg?.constraint };
}
