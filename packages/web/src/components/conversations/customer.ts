import type { PanelConversation } from '../../lib/queries';

import { BOT_OPT_IN_REASON, formatPhone } from '../../lib/format';

export const customerName = (conversation: PanelConversation) =>
  conversation.customer.name ?? formatPhone(conversation.customer.phone);

/**
 * Up to two initials of the name; `#` when the customer only has a phone.
 */
export const customerInitials = (conversation: PanelConversation) =>
  conversation.customer.name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || '#';

/**
 * Someone at the store must act: a person is handling it, or the bot waits for an approval. Not the conversations
 * that only wait to be passed to the bot.
 */
export const needsPerson = (conversation: PanelConversation) =>
  (conversation.mode === 'human' && conversation.handoff_reason !== BOT_OPT_IN_REASON) ||
  !!conversation.approval_reason;
