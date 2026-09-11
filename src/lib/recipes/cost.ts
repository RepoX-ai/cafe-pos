import { microsToRupiah, multiplyQuantityByRate, sumMicros, type Micros } from "@/lib/money/money";

export interface RecipeCostLine {
  ingredientId: string;
  quantityBaseUnits: number;
  wastePercentage: number;
  costPerBaseUnit: string | number; // exact decimal rate
}

export interface RecipeLineCostResult {
  ingredientId: string;
  effectiveQuantityBaseUnits: number;
  lineCostRupiah: number;
}

/** Waste percentage inflates how much is actually drawn from stock, not the recipe's stated quantity. */
export function effectiveQuantity(quantityBaseUnits: number, wastePercentage: number): number {
  return quantityBaseUnits * (1 + wastePercentage / 100);
}

export function calculateRecipeLineCost(line: RecipeCostLine): RecipeLineCostResult {
  const qty = effectiveQuantity(line.quantityBaseUnits, line.wastePercentage);
  const micros = multiplyQuantityByRate(qty, line.costPerBaseUnit);
  return {
    ingredientId: line.ingredientId,
    effectiveQuantityBaseUnits: qty,
    lineCostRupiah: microsToRupiah(micros),
  };
}

/** Total recipe cost, rounded once at the end from summed micro-Rupiah (avoids compounding per-line rounding error). */
export function calculateRecipeCost(lines: RecipeCostLine[]): number {
  const microValues: Micros[] = lines.map((line) => {
    const qty = effectiveQuantity(line.quantityBaseUnits, line.wastePercentage);
    return multiplyQuantityByRate(qty, line.costPerBaseUnit);
  });
  return microsToRupiah(sumMicros(microValues));
}
