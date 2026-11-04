import { useMe } from './queries';

export type StoreType = 'food' | 'retail';

/**
 * What the store calls its product list: a restaurant menu ("cardápio") or a shop catalog ("catálogo").
 */
export const menuWord = (type: StoreType | undefined) => (type === 'retail' ? 'catálogo' : 'cardápio');

/**
 * The panel store's word, lower case and title case ("Cardápio" as a heading); `retail` picks shop examples.
 */
export const usePanelMenuWord = () => {
  const type = useMe().data?.store?.store_type;
  const word = menuWord(type);

  return { word, title: word.charAt(0).toUpperCase() + word.slice(1), retail: type === 'retail' };
};
