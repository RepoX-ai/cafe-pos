import { z } from "zod";
import { BOUNDS, calendarDateSchema, idempotencyKeySchema } from "./bounds";

export const EXPENSE_CATEGORIES = [
  "rent",
  "salary",
  "electricity",
  "water",
  "internet",
  "gas",
  "packaging",
  "maintenance",
  "marketing",
  "delivery",
  "payment_fee",
  "other",
] as const;

export const expenseInputSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().int().positive("Amount must be greater than zero").max(BOUNDS.maxInt, "Amount is too large"),
  expenseDate: calendarDateSchema,
  payee: z.string().trim().max(200).optional().or(z.literal("")),
  referenceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  idempotencyKey: idempotencyKeySchema,
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;
