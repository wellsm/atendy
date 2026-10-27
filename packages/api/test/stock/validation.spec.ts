import { deepEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StockUnit } from '../../src/stock/types';
import { StockError, validateItem, validatePackages } from '../../src/stock/validation';

const failsOn = (field: string) => (error: unknown) => error instanceof StockError && error.field === field;

const item = (overrides: Partial<Parameters<typeof validateItem>[0]> = {}) => ({
  name: 'Farinha',
  unit: StockUnit.Gram,
  barcode: null,
  minQty: null,
  ...overrides
});

describe('validateItem', () => {
  it('trims the name', () => {
    deepEqual(validateItem(item({ name: '  Farinha  ' })).name, 'Farinha');
  });

  it('rejects empty and long names', () => {
    throws(() => validateItem(item({ name: '   ' })), failsOn('name'));
    throws(() => validateItem(item({ name: 'a'.repeat(81) })), failsOn('name'));
  });

  it('checks the barcode', () => {
    throws(() => validateItem(item({ barcode: '12a45678' })), failsOn('barcode'));
    throws(() => validateItem(item({ barcode: '1234567' })), failsOn('barcode'));
    throws(() => validateItem(item({ barcode: '123456789012345' })), failsOn('barcode'));
    deepEqual(validateItem(item({ barcode: '7894900011517' })).barcode, '7894900011517');
  });

  it('checks the minimum', () => {
    throws(() => validateItem(item({ minQty: -1 })), failsOn('min_qty'));
    throws(() => validateItem(item({ minQty: 1.5 })), failsOn('min_qty'));
    deepEqual(validateItem(item({ minQty: 0 })).minQty, 0);
  });
});

describe('validatePackages', () => {
  it('rejects a factor below 2', () => {
    throws(() => validatePackages([{ name: 'Saco', factor: 1, barcode: null }]), failsOn('packages'));
  });

  it('rejects repeated names', () => {
    throws(
      () =>
        validatePackages([
          { name: 'Saco', factor: 2, barcode: null },
          { name: 'saco', factor: 5, barcode: null }
        ]),
      failsOn('packages')
    );
  });

  it('accepts valid packages', () => {
    deepEqual(validatePackages([{ name: ' Caixa ', factor: 12, barcode: null }]), [
      { name: 'Caixa', factor: 12, barcode: null }
    ]);
  });
});
