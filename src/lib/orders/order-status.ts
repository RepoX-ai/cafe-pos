import type { BadgeTone } from "@/components/ui/badge";

/**
 * Plain data shared by the admin and POS order lists. Kept out of the
 * client components that use it (see the RSC gotcha in CLAUDE.md).
 */
export const ORDER_STATUSES = ["SUBMITTED", "PRINT_PENDING", "PRINTED", "COMPLETED", "CANCELLED", "REFUNDED"] as const;

export const ORDER_STATUS_TONE: Record<string, BadgeTone> = {
  SUBMITTED: "accent",
  PRINT_PENDING: "warning",
  PRINTED: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "danger",
};
