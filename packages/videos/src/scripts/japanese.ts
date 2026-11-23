import type { VideoScript } from '../types.ts';

// Names and prices copied from packages/api/src/menu/demo-menus/japanese.ts.
export const JAPANESE: VideoScript = {
  slug: 'japanese',
  storeName: 'Sushi Maré Alta',
  storeType: 'food',
  hook: 'Sábado à noite.\nTodo mundo quer sushi na mesma hora.',
  caption: 'Do "oi" ao pedido, sem ninguém atender',
  messages: [
    { from: 'customer', text: 'Oi! Quero o combinado tradicional' },
    {
      from: 'bot',
      text: 'Boa noite, Marina! 🍣 *Combinado Tradicional 16 peças* anotado. Quer uma bebida?',
      label: '✅ Item anotado',
      step: 1
    },
    { from: 'customer', text: 'Uma água com gás' },
    { from: 'bot', text: 'Anotado! É *entrega* ou *retirada*?' },
    { from: 'customer', text: 'Entrega. Av. Central, 450, ap 32' },
    {
      from: 'bot',
      text: 'Perfeito! Entrega: *R$ 7,00*. Como prefere pagar?',
      label: '📍 Endereço ok',
      step: 2
    },
    { from: 'customer', text: 'Cartão de crédito', label: '💳 Crédito', step: 3 },
    {
      from: 'bot',
      text: '🧾 *Resumo do pedido*\n\n➡️ 1x Combinado Tradicional 16 peças\n   • Água mineral com gás 350ml\n   R$ 49,80\n\n🛵 Entrega: R$ 7,00\n💳 Cartão de crédito\n\n💰 *Total: R$ 56,80*'
    },
    { from: 'customer', text: 'Confirmado!' },
    {
      from: 'bot',
      text: 'Pedido confirmado! ✅ Já está na cozinha. Previsão: 50 a 60 min 🛵',
      label: '🧾 Pedido #R6V2JC na cozinha',
      step: 4
    }
  ]
};
