import type { WhatsAppProvider } from './types';

import { EvolutionClient } from './evolution-client';
import { WhatsAppProviderType } from '../stores/types';

export type ProviderStore = {
  whatsapp_provider: WhatsAppProviderType;
  whatsapp_instance?: string | null;
  whatsapp_instance_token?: string | null;
};

export namespace WhatsAppProviders {
  export const forStore = (store: ProviderStore, env: { EVOLUTION_API_URL?: string }): WhatsAppProvider => {
    if (store.whatsapp_provider !== WhatsAppProviderType.Evolution) {
      throw new Error(`WhatsApp provider ${store.whatsapp_provider} is not implemented`);
    }

    const { whatsapp_instance: instance, whatsapp_instance_token: token } = store;
    const baseUrl = env.EVOLUTION_API_URL;

    if (!instance || !token || !baseUrl) {
      throw new Error('Store WhatsApp is not connected');
    }

    return {
      sendText: ({ to, text }) => EvolutionClient.sendText({ baseUrl, instance, token, to, text })
    };
  };
}
