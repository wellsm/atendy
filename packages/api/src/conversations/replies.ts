import type { HourRange } from '../stores/hours';

import { formatHours } from '../stores/hours';

export const CLOSED_REPLY_COOLDOWN_MS = 60 * 60 * 1000;

export const buildClosedReply = (input: { acceptingOrders: boolean; hours: HourRange[] }) => {
  if (!input.acceptingOrders) {
    return 'Olá! No momento não estamos aceitando pedidos. Tente novamente mais tarde, por favor.';
  }

  if (!input.hours.length) {
    return 'Olá! No momento estamos fechados.';
  }

  return `Olá! No momento estamos fechados. Nosso horário:\n${formatHours(input.hours)}`;
};

export const TECHNICAL_ERROR_REPLY =
  'Desculpe, tivemos um problema técnico. Um atendente vai continuar seu atendimento em instantes.';
