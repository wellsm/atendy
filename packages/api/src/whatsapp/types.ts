export const enum ParsedEventKind {
  Message = 'message',
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
  sentAt: string;
};

export type ParsedEvent = ParsedMessage | { kind: ParsedEventKind.Ignored; reason: string };

export type WhatsAppProvider = {
  sendText(input: { to: string; text: string }): Promise<{ providerMessageId: string }>;
};
