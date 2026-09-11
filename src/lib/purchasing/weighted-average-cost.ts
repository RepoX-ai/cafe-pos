/**
 * Weighted average cost (PRD §6.7 worked example):
 *   100g @ Rp10/g existing + 100g @ Rp14/g received -> Rp12/g new average.
 *
 * Base-unit quantities and cost rates are small enough in a single-café
 * deployment that plain double-precision arithmetic carries far more
 * significant digits than the business needs; the PRD allows either
 * integer-safe arithmetic or a decimal numeric type for this calculation,
 * and the result is always stored in an exact Postgres `numeric` column,
 * never treated as a money amount charged to anyone.
 */
export function calculateWeightedAverageCost(params: {
  existingQuantity: number;
  existingAverageCost: number;
  incomingQuantity: number;
  incomingCostPerUnit: number;
}): number {
  const { existingQuantity, existingAverageCost, incomingQuantity, incomingCostPerUnit } = params;
  const totalQuantity = existingQuantity + incomingQuantity;
  if (totalQuantity <= 0) return incomingCostPerUnit;

  const totalValue = existingQuantity * existingAverageCost + incomingQuantity * incomingCostPerUnit;
  return totalValue / totalQuantity;
}
