import type { MenuImport } from './repository';

import { StoreType } from '../stores/types';
import { ACAI_MENU } from './demo-menus/acai';
import { BEAUTY_STUDIO_MENU } from './demo-menus/beauty-studio';
import { BURGER_MENU } from './demo-menus/burger';
import { COSMETICS_MENU } from './demo-menus/cosmetics';
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
  TobaccoLiquor = 'tobacco_liquor',
  Cosmetics = 'cosmetics',
  BeautyStudio = 'beauty_studio'
}

/**
 * Demo menus the admin can load per business type. `DEMO_MENU` (small pizzeria) stays apart for tests and evals.
 */
/**
 * Store type a demo kind sets: cosmetics, tobacco/liquor and the beauty studio talk like a shop, every food kind like a
 * menu.
 */
export const demoStoreType = (kind: DemoMenuKind | undefined) =>
  kind === DemoMenuKind.Cosmetics || kind === DemoMenuKind.TobaccoLiquor || kind === DemoMenuKind.BeautyStudio
    ? StoreType.Retail
    : StoreType.Food;

export const DEMO_MENUS: Record<DemoMenuKind, MenuImport> = {
  [DemoMenuKind.Pizzeria]: PIZZERIA_MENU,
  [DemoMenuKind.Burger]: BURGER_MENU,
  [DemoMenuKind.SnackBar]: SNACK_BAR_MENU,
  [DemoMenuKind.Pasta]: PASTA_MENU,
  [DemoMenuKind.Pastry]: PASTRY_MENU,
  [DemoMenuKind.Acai]: ACAI_MENU,
  [DemoMenuKind.Lunchbox]: LUNCHBOX_MENU,
  [DemoMenuKind.Japanese]: JAPANESE_MENU,
  [DemoMenuKind.TobaccoLiquor]: TOBACCO_LIQUOR_MENU,
  [DemoMenuKind.Cosmetics]: COSMETICS_MENU,
  [DemoMenuKind.BeautyStudio]: BEAUTY_STUDIO_MENU
};

export const countProducts = (menu: MenuImport) =>
  menu.categories.reduce((total, category) => total + category.products.length, 0);
