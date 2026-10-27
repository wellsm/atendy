/**
 * Weighted average cost (millicents per base unit) after an entry. A zero or negative balance, or no average yet,
 * restarts it at the entry's cost.
 */
export const averageCost = (input: { balance: number; avg: number | null; qty: number; unitCost: number }) => {
  if (input.balance <= 0 || input.avg === null) {
    return input.unitCost;
  }

  return Math.round((input.balance * input.avg + input.qty * input.unitCost) / (input.balance + input.qty));
};
