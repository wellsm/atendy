export const enum ConversationMode {
  Bot = 'bot',
  Human = 'human'
}

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
