import { StockUnit } from './types';

export const MAX_NAME_LENGTH = 80;

const BARCODE_PATTERN = /^\d{8,14}$/;

/**
 * A stock value the store must fix. `field` is the wire name the panel highlights.
 */
export class StockError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
  }
}

export type StockItemInput = {
  name: string;
  unit: StockUnit;
  barcode: string | null;
  minQty: number | null;
};

export type StockPackageInput = {
  id?: string;
  name: string;
  factor: number;
  barcode: string | null;
};

const validateName = (field: string, value: string) => {
  const name = value.trim();

  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new StockError(field, `Name must have 1 to ${MAX_NAME_LENGTH} characters.`);
  }

  return name;
};

const validateBarcode = (field: string, value: string | null) => {
  if (value === null) {
    return null;
  }

  const barcode = value.trim();

  if (!BARCODE_PATTERN.test(barcode)) {
    throw new StockError(field, 'Barcode must have 8 to 14 digits.');
  }

  return barcode;
};

export const validateItem = (input: StockItemInput): StockItemInput => {
  if (![StockUnit.Unit, StockUnit.Gram, StockUnit.Milliliter].includes(input.unit)) {
    throw new StockError('unit', 'Unknown unit.');
  }

  if (input.minQty !== null && (!Number.isInteger(input.minQty) || input.minQty < 0)) {
    throw new StockError('min_qty', 'Minimum must be a whole number, zero or more.');
  }

  return {
    name: validateName('name', input.name),
    unit: input.unit,
    barcode: validateBarcode('barcode', input.barcode),
    minQty: input.minQty
  };
};

export const validatePackages = (packages: StockPackageInput[]): StockPackageInput[] => {
  const names = new Set<string>();
  const barcodes = new Set<string>();

  return packages.map((item) => {
    const name = validateName('packages', item.name);
    const barcode = validateBarcode('packages', item.barcode);

    if (!Number.isInteger(item.factor) || item.factor < 2) {
      throw new StockError('packages', 'Package factor must be a whole number of 2 or more.');
    }

    const key = name.toLowerCase();

    if (names.has(key)) {
      throw new StockError('packages', 'Package names must be different.');
    }

    if (barcode && barcodes.has(barcode)) {
      throw new StockError('packages', 'Package barcodes must be different.');
    }

    names.add(key);

    if (barcode) {
      barcodes.add(barcode);
    }

    return { ...(item.id && { id: item.id }), name, factor: item.factor, barcode };
  });
};
