/** Row shapes the menu admin screens receive from menu-service. */

export interface CategoryRow {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

export interface VariantRow {
  id: string;
  name: string;
  price: number;
  active: boolean;
  displayOrder: number;
}

export interface MenuItemRow {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  basePrice: number;
  active: boolean;
  tracksInventory: boolean;
  displayOrder: number;
  variants: VariantRow[];
}

export interface ModifierOptionRow {
  id: string;
  name: string;
  priceAdjustment: number;
  active: boolean;
  displayOrder: number;
}

export interface ModifierGroupRow {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  active: boolean;
  options: ModifierOptionRow[];
}
