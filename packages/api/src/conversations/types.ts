export const enum ConversationMode {
  Bot = 'bot',
  Human = 'human'
}

/**
 * `handoff_reason` of a conversation born with a person in a `policy.bot_opt_in` store: the bot never served it and
 * nobody has to act on it (not counted as needing a person) until the store passes it to the bot.
 */
export const BOT_OPT_IN_REASON = 'bot_opt_in';

/**
 * Mode of a new conversation: the bot, unless the store answers by hand until it passes each one to the bot.
 */
export const initialMode = (botOptIn: boolean | null | undefined) =>
  botOptIn ? { mode: ConversationMode.Human, handoff_reason: BOT_OPT_IN_REASON } : { mode: ConversationMode.Bot };

/**
 * Limits that pause the bot for the store's approval instead of handing the conversation to a person.
 */
export const APPROVAL_REASONS = new Set(['order_limit', 'qty_limit', 'new_customer_review', 'suspected_prank']);

/**
 * Approved reasons that lift the order limits (`max_item_qty`, `max_order_cents`) for the current order.
 */
export const LIMIT_REASONS = new Set(['order_limit', 'qty_limit']);

export const enum MessageDirection {
  In = 'in',
  Out = 'out'
}

export const enum MessageAuthor {
  Customer = 'customer',
  Bot = 'bot',
  Staff = 'staff'
}
