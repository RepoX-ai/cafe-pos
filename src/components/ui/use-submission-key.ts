"use client";

import { useCallback, useState } from "react";

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * An idempotency key for one submission of a form. Send it with the write;
 * call `rotate()` once a response has arrived — success or a definite
 * failure — so the next submission is a new request. When the request
 * itself fails in transit the outcome is unknown, so the key is kept and a
 * retry is recognised server-side instead of recording the write twice.
 */
export function useSubmissionKey(): [key: string, rotate: () => void] {
  const [key, setKey] = useState(newKey);
  const rotate = useCallback(() => setKey(newKey()), []);
  return [key, rotate];
}
