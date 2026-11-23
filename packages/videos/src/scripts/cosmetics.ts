import type { VideoScript } from '../types.ts';

// Names and prices copied from packages/api/src/menu/demo-menus/cosmetics.ts (no product brands).
export const COSMETICS: VideoScript = {
  slug: 'cosmetics',
  storeName: 'Flor de Íris Beleza',
  storeType: 'retail',
  hook: 'Promoção no ar.\nDezenas de clientes perguntando preço.',
  caption: 'Do "oi" ao pedido, sem ninguém atender',
  messages: [
    { from: 'customer', text: 'Oi! Tem hidratante corporal?' },
    {
      from: 'bot',
      text: 'Oi, Júlia! 🌸 Tem sim: *Hidratante Corporal* por *R$ 19,99*. Quer que eu separe?'
    },
    { from: 'customer', text: 'Quero! E uma máscara de cílios', label: '✅ Itens anotados', step: 1 },
    { from: 'bot', text: 'Anotado! *Máscara de Cílios* por *R$ 15,00*. É *entrega* ou *retirada*?' },
    { from: 'customer', text: 'Entrega. Rua do Sol, 88' },
    {
      from: 'bot',
      text: 'Combinado! Entrega: *R$ 6,00*. Como prefere pagar?',
      label: '📍 Endereço ok',
      step: 2
    },
    { from: 'customer', text: 'Pix', label: '💳 Pix', step: 3 },
    {
      from: 'bot',
      text: '🧾 *Resumo do pedido*\n\n➡️ 1x Hidratante Corporal\n   R$ 19,99\n➡️ 1x Máscara de Cílios\n   R$ 15,00\n\n🛵 Entrega: R$ 6,00\n💳 Pix\n\n💰 *Total: R$ 40,99*'
    },
    { from: 'customer', text: 'Pode fechar!' },
    {
      from: 'bot',
      text: 'Pedido confirmado! ✅ Já estamos separando tudo para a entrega 🛵',
      label: '🧾 Pedido #M4X9BD separado',
      step: 4
    }
  ]
};
