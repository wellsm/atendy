import type { HourRange } from '../stores/hours';

import { formatHours } from '../stores/hours';

export const CLOSED_REPLY_COOLDOWN_MS = 60 * 60 * 1000;

export const buildClosedReply = (input: { acceptingOrders: boolean; hours: HourRange[] }) => {
  if (!input.acceptingOrders) {
    return '⏸️ No momento não estamos aceitando pedidos.\nTente novamente mais tarde, por favor 🙏';
  }

  if (!input.hours.length) {
    return '🌙 Estamos fechados no momento.';
  }

  return `🌙 Estamos fechados no momento.\n\n🕐 Nosso horário:\n${formatHours(input.hours)}\n\nAssim que abrirmos, é só mandar mensagem 😊`;
};

export const TECHNICAL_ERROR_REPLY =
  '⚠️ Tivemos um probleminha técnico.\n🙋 Um atendente vai continuar seu atendimento em instantes.';

/**
 * Most WhatsApp messages one model reply may become; extra parts join the last one.
 */
const MAX_REPLY_MESSAGES = 4;

/**
 * The model separates WhatsApp messages with a line `---`: each part goes out as its own message.
 */
export const splitMessages = (text: string) => {
  const parts = text
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return [text];
  }

  return parts.length > MAX_REPLY_MESSAGES
    ? [...parts.slice(0, MAX_REPLY_MESSAGES - 1), parts.slice(MAX_REPLY_MESSAGES - 1).join('\n\n')]
    : parts;
};
