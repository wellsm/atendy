import type { VideoScript } from '../types.ts';

// Names and prices copied from packages/api/src/menu/demo-menus/pizzeria.ts.
export const PIZZERIA: VideoScript = {
  slug: 'pizzeria',
  storeName: 'Pizzaria Forno Dourado',
  storeType: 'food',
  hook: 'Sexta, 20h.\n14 clientes chamando ao mesmo tempo.',
  caption: 'Do "oi" ao pedido, sem ninguém atender',
  messages: [
    { from: 'customer', text: 'Oi, quero uma calabresa grande' },
    {
      from: 'bot',
      text: 'Boa noite, Ana! 🍕 *Pizza Grande de Calabresa* anotada. Quer borda recheada?',
      label: '✅ Item anotado',
      step: 1
    },
    { from: 'customer', text: 'Sim, catupiry' },
    { from: 'bot', text: 'Fechado! É *entrega* ou *retirada*?' },
    { from: 'customer', text: 'Entrega. Rua das Flores, 120' },
    {
      from: 'bot',
      text: 'Anotado! Entrega: *R$ 6,00*. Como prefere pagar?',
      label: '📍 Endereço ok',
      step: 2
    },
    { from: 'customer', text: 'Pix', label: '💳 Pix', step: 3 },
    {
      from: 'bot',
      text: '🧾 *Resumo do pedido*\n\n➡️ 1x Pizza Grande\n   • Calabresa\n   • Borda Catupiry\n   R$ 57,90\n\n🛵 Entrega: R$ 6,00\n💳 Pix\n\n💰 *Total: R$ 63,90*'
    },
    { from: 'customer', text: 'Pode mandar!' },
    {
      from: 'bot',
      text: 'Pedido confirmado! ✅ Já está na cozinha. Previsão: 40 a 50 min 🛵',
      label: '🧾 Pedido #K7R4MP na cozinha',
      step: 4
    }
  ]
};
