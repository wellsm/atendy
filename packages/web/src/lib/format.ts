const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatMoney = (cents: number) => money.format(cents / 100);

/**
 * Money typed by the store (`12`, `12,5`, `12,50`, `R$ 12,50`, `12.50`) in cents; `undefined` when not a value.
 */
export const parseMoney = (text: string) => {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.replace(/R\$/i, '').trim());

  if (!match) {
    return undefined;
  }

  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
};

/**
 * Cents as the store types them: `1250` → `12,50`.
 */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/**
 * Time only for today, date and time otherwise.
 */
export const formatWhen = (iso: string | null) => {
  if (!iso) {
    return '';
  }

  const date = new Date(iso);

  return date.toDateString() === new Date().toDateString() ? time.format(date) : dateTime.format(date);
};

export const formatPhone = (phone: string) => {
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);

  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
};

/**
 * Who an order is for: the name, else the phone; a counter sale without either is "Balcão".
 */
export const orderCustomerName = ({ customer }: { customer: { name: string | null; phone: string | null } }) =>
  customer.name ?? (customer.phone ? formatPhone(customer.phone) : 'Balcão');

/**
 * Mask while typing a Brazilian phone: `(11) 98888-7777` / `(11) 3333-4444`. A pasted `+55` is dropped.
 */
export const maskPhoneInput = (typed: string) => {
  const all = typed.replace(/\D/g, '');
  const digits = (all.length > 11 && all.startsWith('55') ? all.slice(2) : all).slice(0, 11);
  const split = digits.length === 11 ? 7 : 6;

  if (digits.length <= 2) {
    return digits.length ? `(${digits}` : '';
  }

  if (digits.length <= split) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, split)}-${digits.slice(split)}`;
};

export const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro',
  voucher: 'Vale-refeição/alimentação'
};

export const STATUS_LABEL: Record<string, string> = {
  placed: 'Novo',
  accepted: 'Em preparo',
  out: 'Saiu',
  done: 'Concluído',
  canceled: 'Cancelado',
  abandoned: 'Abandonado'
};

const HANDOFF_LABEL: Record<string, string> = {
  customer_asked: 'Cliente pediu atendente',
  new_customer_review: 'Revisar pedido de cliente novo',
  no_intent: 'O bot não entendeu',
  order_not_editable: 'Cliente quer alterar pedido aceito',
  order_already_accepted: 'Cliente quer alterar pedido aceito',
  suspected_prank: 'Possível trote',
  cancel_request: 'Cliente quer cancelar',
  qty_limit: 'Quantidade acima do limite',
  order_limit: 'Pedido acima do limite',
  technical_error: 'Erro técnico no bot',
  send_failed: 'Falha ao enviar resposta',
  staff_replied_from_phone: 'Respondida pelo celular',
  staff_replied_from_panel: 'Respondida pelo painel',
  staff_took_over: 'Assumida pela loja'
};

/**
 * Handoffs that only a person at the store causes: approvals become handoffs only when someone clicks "Assumir".
 */
const STAFF_REASONS = new Set([
  'staff_took_over',
  'staff_replied_from_panel',
  'staff_replied_from_phone',
  'order_limit',
  'qty_limit',
  'new_customer_review',
  'suspected_prank'
]);

export const staffActed = (reason: string | null) => !!reason && STAFF_REASONS.has(reason);

export const handoffLabel = (reason: string | null) => (reason && HANDOFF_LABEL[reason]) || 'Precisa de atendente';
