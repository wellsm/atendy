import type { MenuImport } from './repository';

import { ACAI_MENU } from './demo-menus/acai';
import { BURGER_MENU } from './demo-menus/burger';
import { JAPANESE_MENU } from './demo-menus/japanese';
import { LUNCHBOX_MENU } from './demo-menus/lunchbox';
import { PASTA_MENU } from './demo-menus/pasta';
import { PASTRY_MENU } from './demo-menus/pastry';
import { PIZZERIA_MENU } from './demo-menus/pizzeria';
import { SNACK_BAR_MENU } from './demo-menus/snack-bar';
import { TOBACCO_LIQUOR_MENU } from './demo-menus/tobacco-liquor';

export const enum DemoMenuKind {
  Pizzeria = 'pizzeria',
  Burger = 'burger',
  SnackBar = 'snack_bar',
  Pasta = 'pasta',
  Pastry = 'pastry',
  Acai = 'acai',
  Lunchbox = 'lunchbox',
  Japanese = 'japanese',
  TobaccoLiquor = 'tobacco_liquor'
}

/**
 * Demo menus the admin can load per business type. `DEMO_MENU` (small pizzeria) stays apart for tests and evals.
 */
export const DEMO_MENUS: Record<DemoMenuKind, MenuImport> = {
  [DemoMenuKind.Pizzeria]: PIZZERIA_MENU,
  [DemoMenuKind.Burger]: BURGER_MENU,
  [DemoMenuKind.SnackBar]: SNACK_BAR_MENU,
  [DemoMenuKind.Pasta]: PASTA_MENU,
  [DemoMenuKind.Pastry]: PASTRY_MENU,
  [DemoMenuKind.Acai]: ACAI_MENU,
  [DemoMenuKind.Lunchbox]: LUNCHBOX_MENU,
  [DemoMenuKind.Japanese]: JAPANESE_MENU,
  [DemoMenuKind.TobaccoLiquor]: TOBACCO_LIQUOR_MENU
};

export const countProducts = (menu: MenuImport) =>
  menu.categories.reduce((total, category) => total + category.products.length, 0);
