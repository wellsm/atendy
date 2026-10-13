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

export const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro'
};

export const STATUS_LABEL: Record<string, string> = {
  placed: 'Novo',
  accepted: 'Em preparo',
  out: 'Saiu',
  done: 'Concluído',
  canceled: 'Cancelado'
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

export const handoffLabel = (reason: string | null) => (reason && HANDOFF_LABEL[reason]) || 'Precisa de atendente';
