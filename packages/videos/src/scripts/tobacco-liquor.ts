import type { VideoScript } from '../types.ts';

// Names and prices copied from packages/api/src/menu/demo-menus/tobacco-liquor.ts (no product brands).
// No tobacco on screen (spec): beer, ice and charcoal only. Has alcohol: WhatsApp only, not for ads.
export const TOBACCO_LIQUOR: VideoScript = {
  slug: 'tobacco-liquor',
  storeName: 'Adega e Tabacaria Farol 27',
  storeType: 'retail',
  hook: 'Sábado, 22h.\nLoja cheia e o WhatsApp tocando sem parar.',
  caption: 'Do "oi" ao pedido, sem ninguém atender',
  messages: [
    { from: 'customer', text: 'Boa noite! Quero um fardo de cerveja gelada' },
    {
      from: 'bot',
      text: 'Boa noite, Rafael! 🍺 *Fardo 12 Latas 350ml* anotado. Mais alguma coisa?',
      label: '✅ Item anotado',
      step: 1
    },
    { from: 'customer', text: 'Um gelo de 5kg e um carvão' },
    { from: 'bot', text: 'Anotado! É *entrega* ou *retirada*?' },
    { from: 'customer', text: 'Entrega. Rua Sete, 310' },
    {
      from: 'bot',
      text: 'Fechado! Entrega: *R$ 5,00*. Como prefere pagar?',
      label: '📍 Endereço ok',
      step: 2
    },
    { from: 'customer', text: 'Pix', label: '💳 Pix', step: 3 },
    {
      from: 'bot',
      text: '🧾 *Resumo do pedido*\n\n➡️ 1x Fardo 12 Latas 350ml\n   R$ 47,90\n➡️ 1x Gelo em Cubo 5kg\n   R$ 15,90\n➡️ 1x Carvão de Coco 1kg\n   R$ 29,90\n\n🛵 Entrega: R$ 5,00\n💳 Pix\n\n💰 *Total: R$ 98,70*'
    },
    { from: 'customer', text: 'Pode mandar!' },
    {
      from: 'bot',
      text: 'Pedido confirmado! ✅ Já estamos separando. Previsão: 30 a 40 min 🛵',
      label: '🧾 Pedido #W5N8GK separado',
      step: 4
    }
  ]
};
