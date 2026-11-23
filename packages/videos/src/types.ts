export type ScriptMessage = {
  from: 'customer' | 'bot';
  // WhatsApp formatting: *bold*, \n for line breaks.
  text: string;
  // Floating label that appears with this message.
  label?: string;
  // Step bar value from this message on.
  step?: 1 | 2 | 3 | 4;
};

export type VideoScript = {
  slug: string;
  storeName: string;
  storeType: 'food' | 'retail';
  // Opening line on the dark background.
  hook: string;
  // Stays above the phone during the conversation.
  caption: string;
  messages: ScriptMessage[];
};
