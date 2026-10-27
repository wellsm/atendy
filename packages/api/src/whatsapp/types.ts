export const enum ParsedEventKind {
  Message = 'message',
  Reaction = 'reaction',
  Ignored = 'ignored'
}

export type ParsedMessage = {
  kind: ParsedEventKind.Message;
  instance: string;
  providerMessageId: string;
  fromMe: boolean;
  /**
   * Address to reply to, exactly as received.
   */
  jid: string;
  /**
   * Digits only. Real phone when known, otherwise the `@lid` digits.
   */
  phone: string;
  pushName?: string;
  text: string;
  /**
   * Raw `{ key, message }` of a voice note, to download and transcribe it later.
   */
  voiceNote?: Record<string, unknown>;
  sentAt: string;
};

/**
 * A customer reacted to a message (or removed the reaction: empty `emoji`).
 */
export type ParsedReaction = Omit<ParsedMessage, 'kind' | 'text' | 'voiceNote'> & {
  kind: ParsedEventKind.Reaction;
  /**
   * Provider id of the reacted message.
   */
  reactedId: string;
  emoji: string;
};

export type ParsedEvent = ParsedMessage | ParsedReaction | { kind: ParsedEventKind.Ignored; reason: string };

export type WhatsAppProvider = {
  /**
   * `delayMs`: "digitando…" for that long before the message goes out (the next message of a split reply).
   */
  sendText(input: { to: string; text: string; delayMs?: number }): Promise<{ providerMessageId: string }>;
  /**
   * Shows "digitando…" to the customer, best effort (never throws). Call the returned stop before replying.
   */
  startTyping(input: { to: string }): () => Promise<void>;
  /**
   * Bytes of a received media message (`ParsedMessage.voiceNote`), base64 encoded.
   */
  downloadMedia(input: { message: Record<string, unknown> }): Promise<{ base64: string; mimetype: string }>;
};
