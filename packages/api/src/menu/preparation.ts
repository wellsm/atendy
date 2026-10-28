/**
 * Whether a sale needs the kitchen: any line whose product flag (else its category's) is true.
 */
export const needsPreparation = (lines: { categoryNeeds: boolean | null; productNeeds: boolean | null }[]) =>
  lines.some(({ categoryNeeds, productNeeds }) => productNeeds ?? categoryNeeds ?? false);
