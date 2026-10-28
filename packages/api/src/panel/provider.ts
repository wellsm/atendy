import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { InboundQueue } from '../conversations/queues/inbound';
import type { Db } from '../db';
import type { PanelEventsQueue } from '../realtime/queues/panel-events';
import type { ProductImages, VoiceNotes } from '../storage';

export declare class PanelProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Menu endpoints that return products (signed `imageUrl`) or handle their photos.
 */
export declare class PanelMenuProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    productImages: Environment.Service<ProductImages>;
  };
}

/**
 * The conversation thread: messages carry signed URLs of saved voice notes.
 */
export declare class PanelThreadProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    voiceNotes: Environment.Service<VoiceNotes>;
  };
}

/**
 * Conversation endpoints that hand the conversation back to the bot: they queue its pending messages.
 */
export declare class PanelConversationProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
    inboundQueue: Environment.Service<InboundQueue>;
  };
}

/**
 * Panel authorizer: verifies the Clerk session token (`CLERK_JWT_KEY`, the instance PEM public key).
 */
export declare class PanelAuthProvider implements Http.Provider {
  variables: {
    CLERK_JWT_KEY: Environment.Variable<'CLERK_JWT_KEY'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

/**
 * Store WhatsApp instance create/connect/state/logout (`StoreWhatsApp`).
 */
export declare class PanelWhatsAppProvider implements Http.Provider {
  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    // Global Evolution key: instance create/connect/state/logout only, never returned to the panel.
    EVOLUTION_API_KEY: Environment.Variable<'EVOLUTION_API_KEY'>;
    WEBHOOK_BASE_URL: Environment.Variable<'WEBHOOK_BASE_URL'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Staff messages and order status messages (`sendStaffMessage`): sent with the store's instance token.
 */
export declare class PanelSendProvider implements Http.Provider {
  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
  };

  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
  };
}

/**
 * Store location (distance delivery).
 */
export declare class PanelGeocodingProvider implements Http.Provider {
  variables: {
    /**
     * Google Geocoding. Server-side only.
     */
    GOOGLE_MAPS_API_KEY: Environment.Variable<'GOOGLE_MAPS_API_KEY'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Attendant drafts: addresses are geocoded (distance delivery) and every change tells the open panels.
 */
export declare class PanelDraftProvider implements Http.Provider {
  variables: {
    GOOGLE_MAPS_API_KEY: Environment.Variable<'GOOGLE_MAPS_API_KEY'>;
  };

  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
  };
}

/**
 * POS finalize and cancel: they change the orders board.
 */
export declare class PanelPosProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
  };
}

/**
 * Store card registration on Asaas.
 */
export declare class PanelBillingProvider implements Http.Provider {
  variables: {
    /**
     * `https://api-sandbox.asaas.com/v3` on dev. The key never leaves the API.
     */
    ASAAS_API_URL: Environment.Variable<'ASAAS_API_URL'>;
    ASAAS_API_KEY: Environment.Variable<'ASAAS_API_KEY'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Store creation: tells the admin on Telegram (`notifyAdmin`).
 */
export declare class PanelOnboardingProvider implements Http.Provider {
  variables: {
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}
