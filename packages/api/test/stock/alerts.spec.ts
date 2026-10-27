import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatLowStockDigest } from '../../src/stock/alerts';
import { StockUnit } from '../../src/stock/types';

const URL = 'https://app.test/panel/x?sheet=stock&filter=low';

describe('formatLowStockDigest', () => {
  it('formats units, kg and the minimum', () => {
    const text = formatLowStockDigest(
      [
        { name: 'Coca-Cola lata 350 ml', unit: StockUnit.Unit, balance: 3, minQty: 12 },
        { name: 'Mussarela', unit: StockUnit.Gram, balance: 1200, minQty: 5000 }
      ],
      URL
    );

    equal(
      text,
      `📦 *Estoque baixo*\n\n• Coca-Cola lata 350 ml: 3 un (mín. 12)\n• Mussarela: 1,2 kg (mín. 5 kg)\n\nVer no painel: ${URL}`
    );
  });

  it('uses g and ml below 1000 and L from 1000', () => {
    const text = formatLowStockDigest(
      [
        { name: 'Sal', unit: StockUnit.Gram, balance: 800, minQty: 1000 },
        { name: 'Óleo', unit: StockUnit.Milliliter, balance: 2500, minQty: 3000 },
        { name: 'Leite', unit: StockUnit.Milliliter, balance: 500, minQty: 600 }
      ],
      URL
    );

    equal(text.includes('• Sal: 800 g (mín. 1 kg)'), true);
    equal(text.includes('• Óleo: 2,5 L (mín. 3 L)'), true);
    equal(text.includes('• Leite: 500 ml (mín. 600 ml)'), true);
  });

  it('caps at 20 lines and counts the rest', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({
      name: `Item ${i}`,
      unit: StockUnit.Unit,
      balance: 1,
      minQty: 2
    }));
    const text = formatLowStockDigest(items, URL);

    equal(text.split('\n').filter((line) => line.startsWith('• ')).length, 20);
    equal(text.includes('… e mais 3 itens'), true);
  });
});
