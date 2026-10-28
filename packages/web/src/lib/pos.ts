export type PosLayout = 'grid' | 'search';

export const BARCODE = /^\d{6,20}$/;

/**
 * What the operator typed or a reader sent: `3*7891234` is quantity 3 of that code (or name), else quantity 1.
 */
export const parseScan = (text: string) => {
  const match = /^(?:(\d{1,3})\s*\*\s*)?(.*)$/.exec(text.trim());
  const qty = match?.[1] ? Number(match[1]) : 1;
  const code = match?.[2]?.trim() ?? '';

  if (!code || qty < 1) {
    return undefined;
  }

  return { qty, code };
};

const layoutKey = (slug: string) => `atendy:pos-layout:${slug}`;

/**
 * This browser's layout choice for the store; undefined = the store's default (`pos.layout`).
 */
export const readPosLayout = (slug: string): PosLayout | undefined => {
  try {
    const value = localStorage.getItem(layoutKey(slug));

    return value === 'grid' || value === 'search' ? value : undefined;
  } catch {
    return undefined;
  }
};

export const savePosLayout = (slug: string, layout: PosLayout) => {
  try {
    localStorage.setItem(layoutKey(slug), layout);
  } catch {
    // Private mode: the choice still holds for this visit.
  }
};
