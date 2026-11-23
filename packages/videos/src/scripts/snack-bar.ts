import type { VideoScript } from '../types.ts';

// Names and prices copied from packages/api/src/menu/demo-menus/snack-bar.ts.
export const SNACK_BAR: VideoScript = {
  slug: 'snack-bar',
  storeName: 'Lanchonete Três Esquinas',
  storeType: 'food',
  hook: 'Meio-dia.\nBalcão cheio e o WhatsApp não para.',
  caption: 'Do "oi" ao pedido, sem ninguém atender',
  messages: [
    { from: 'customer', text: 'Boa tarde! Quero um X-Bacon' },
    {
      from: 'bot',
      text: 'Boa tarde, Carlos! 🍔 *X-Bacon* anotado. Quer algum adicional?',
      label: '✅ Item anotado',
      step: 1
    },
    { from: 'customer', text: 'Com ovo, por favor' },
    { from: 'bot', text: 'Anotado! É *entrega* ou *retirada*?' },
    { from: 'customer', text: 'Vou retirar aí' },
    {
      from: 'bot',
      text: 'Combinado, *retirada na loja*. Como prefere pagar?',
      label: '🛍️ Retirada ok',
      step: 2
    },
    { from: 'customer', text: 'Dinheiro', label: '💵 Dinheiro', step: 3 },
    {
      from: 'bot',
      text: '🧾 *Resumo do pedido*\n\n➡️ 1x X-Bacon\n   • Ovo\n   R$ 27,40\n\n🛍️ Retirada na loja\n💵 Dinheiro\n\n💰 *Total: R$ 27,40*'
    },
    { from: 'customer', text: 'Isso mesmo!' },
    {
      from: 'bot',
      text: 'Pedido confirmado! ✅ Já está na cozinha. Fica pronto em uns 20 min 🍔',
      label: '🧾 Pedido #H8T3WN na cozinha',
      step: 4
    }
  ]
};
