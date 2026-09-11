import { z } from "zod";

export const businessSettingsInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  receiptFooter: z.string().trim().max(500).optional().or(z.literal("")),
  orderNumberPrefix: z.string().trim().min(1).max(20),
  taxEnabled: z.coerce.boolean(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  taxInclusive: z.coerce.boolean().default(false),
  serviceChargeEnabled: z.coerce.boolean(),
  serviceChargePercent: z.coerce.number().min(0).max(100).default(0),
  allowNegativeStock: z.coerce.boolean(),
});

export type BusinessSettingsInput = z.infer<typeof businessSettingsInputSchema>;
