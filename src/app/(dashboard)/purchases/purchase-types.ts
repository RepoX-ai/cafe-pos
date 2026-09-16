/** Shapes and labels shared by the purchases screens. */

import type { BaseUnit } from "@/lib/units/units";

export interface IngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
}

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
}

export interface PurchaseRow {
  id: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  status: string;
  totalCost: number;
  supplierName: string | null;
  createdAt: string | Date;
}

export interface LineDraft {
  key: string;
  ingredientId: string;
  quantityPurchased: string;
  purchaseUnit: string;
  conversionToBaseUnits: string;
  /** True while the line is on a pack unit the dropdown doesn't cover. */
  customPack: boolean;
  unitPurchaseCost: string;
}
