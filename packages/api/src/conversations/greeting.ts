import { normalizeText } from '../menu/search';
import { StoreType } from '../stores/types';

/**
 * Words a "just saying hello" batch may have. Anything else (an item, "pedido", "cardápio") goes to the model.
 */
const GREETING_WORDS = new Set([
  'oi',
  'oie',
  'ola',
  'opa',
  'eai',
  'eae',
  'e',
  'ai',
  'salve',
  'hey',
  'hello',
  'bom',
  'boa',
  'dia',
  'tarde',
  'noite',
  'tudo',
  'td',
  'bem',
  'beleza',
  'blz',
  'como',
  'vai',
  'voce',
  'vc',
  'ta',
  'esta'
]);

const NAME_MAX_LENGTH = 30;

const localHour = (timeZone: string, now: Date) => {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);

  return Number(hour);
};

/**
 * `Bom dia` 05:00–11:59, `Boa tarde` 12:00–17:59, `Boa noite` otherwise, in the store timezone.
 */
export const greetingPeriod = (timeZone: string, now: Date) => {
  const hour = localHour(timeZone, now);

  if (hour >= 5 && hour < 12) {
    return 'Bom dia';
  }

  return hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
};

/**
 * First word of the WhatsApp push name, when it is a name (has letters).
 */
export const firstName = (name: string | null | undefined) => {
  const first = name?.trim().split(/\s+/)[0]?.replace(/\*/g, '').slice(0, NAME_MAX_LENGTH);

  return first && /\p{L}/u.test(first) ? first : undefined;
};

/**
 * Whether the customer only said hello (no request the model must answer).
 */
export const isGreetingOnly = (bodies: string[]) => {
  const words = bodies.flatMap((body) => normalizeText(body).split(' ')).filter(Boolean);

  return words.length > 0 && words.every((word) => GREETING_WORDS.has(word));
};

/**
 * First messages of each visit to a `redirect_only` store: the hello and the store's welcome (default: the link).
 */
export const buildRedirectWelcome = (input: {
  period: string;
  name?: string;
  storeName: string;
  redirect: { label: string; url: string };
  welcomeText?: string | null;
}) => [
  `${input.period}${input.name ? `, ${input.name}` : ''}! 👋 Este é o atendimento da loja *${input.storeName.replace(/\*/g, '').trim()}* 😊`,
  input.welcomeText?.trim() ||
    `👉 *${input.redirect.label.replace(/\*/g, '').trim()}*: é só usar o link abaixo\n${input.redirect.url}\n\nSe tiver alguma dúvida, é só perguntar por aqui 💬`
];

/**
 * The store's fixed greeting, one entry per WhatsApp message. `standalone`: a new customer who only said hello gets the
 * full welcome with the menu link and no model reply; otherwise one message goes before the model's reply.
 */
export const buildGreeting = (input: {
  period: string;
  name?: string;
  storeName: string;
  menuUrl: string;
  newCustomer: boolean;
  standalone: boolean;
  storeType?: StoreType | null;
  /**
   * The store's own last message of the standalone welcome (admin `welcome_text`), instead of the catalog link.
   */
  welcomeText?: string | null;
}) => {
  const hello = `${input.period}${input.name ? `, ${input.name}` : ''}! 👋`;
  const store = `*${input.storeName.replace(/\*/g, '').trim()}*`;

  if (!input.newCustomer) {
    return [
      `${hello} Que bom te ver de novo por aqui.\nSou o atendente virtual da loja ${store} 🤖 Se quiser falar com um atendente, é só pedir.`
    ];
  }

  if (!input.standalone) {
    return [`${hello} Sou o atendente virtual da loja ${store} 🤖\nSe quiser falar com um atendente, é só pedir.`];
  }

  return [
    hello,
    `Seja bem-vindo(a)! Este é o atendimento da loja ${store} 😊\nSou o atendente virtual 🤖 e posso montar seu pedido por aqui.`,
    input.welcomeText?.trim() ||
      [
        'Vi que é sua primeira vez com a gente, que bom te ver por aqui! ✨',
        `Se preferir, nosso ${input.storeType === StoreType.Retail ? 'catálogo' : 'cardápio'} completo está aqui e dá para pedir direto por ele 👇`,
        input.menuUrl,
        '',
        'Ou é só me dizer o que vai querer 💬 E se quiser falar com um atendente, é só pedir 🙋'
      ].join('\n')
  ];
};
