export const enum ProspectStatus {
  Available = 'available',
  Queued = 'queued',
  Sending = 'sending',
  Sent = 'sent',
  Delivered = 'delivered',
  Read = 'read',
  Replied = 'replied',
  Failed = 'failed',
  Canceled = 'canceled',
  Manual = 'manual'
}

export const enum ProspectSituation {
  WhatsApp = 'whatsapp',
  OnlineOrder = 'online_order',
  Marketplace = 'marketplace',
  Competitor = 'competitor',
  None = 'none'
}

export const enum ProspectSystemKind {
  Bot = 'bot',
  Market = 'market',
  Whats = 'whats',
  Other = 'other'
}

export type ProspectSystem = { name: string; kind: ProspectSystemKind; source?: string };

export type ProspectDetails = {
  category?: string;
  neighborhood?: string;
  zone?: string;
  city?: string;
  postalCode?: string;
  situation?: ProspectSituation;
  systems?: ProspectSystem[];
  rating?: number;
  reviews?: number;
  score?: number;
  site?: string;
  mobile?: boolean;
};

export const enum ProspectPauseReason {
  Manual = 'manual',
  Disconnected = 'disconnected',
  Failures = 'failures',
  LowReplies = 'low_replies'
}

/**
 * Sending hours in Brazil (UTC−3), end exclusive; weekdays follow `Date.getUTCDay` (0 = Sunday).
 */
export type SendWindow = { startHour: number; endHour: number; weekdays: number[] };

export const DEFAULT_WINDOW: SendWindow = { startHour: 10, endHour: 18, weekdays: [1, 2, 3, 4, 5, 6] };

export const DEFAULT_MAX_DAILY = 50;
