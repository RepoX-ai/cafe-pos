import { z } from "zod";

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
  amount: z.coerce.number().int().positive("Amount must be greater than zero"),
  expenseDate: z.string().min(1, "Date is required"),
  payee: z.string().trim().max(200).optional().or(z.literal("")),
  referenceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;
