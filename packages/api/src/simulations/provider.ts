import type { DbClient } from '../db';
import type { WhatsAppProvider } from '../whatsapp/types';

import { randomUUID } from 'node:crypto';

export type SimulationStep = {
  simulationId: string;
};

export namespace SimulatorProvider {
  /**
   * WhatsApp of a simulated customer (`@sim`: admin simulations and demo phones): nothing leaves the API.
   */
  export const noop: WhatsAppProvider = {
    sendText: () => Promise.resolve({ providerMessageId: `sim:${randomUUID()}` }),
    startTyping: () => () => Promise.resolve(),
    downloadMedia: () => Promise.reject(new Error('Simulated customers send text only'))
  };

  /**
   * WhatsApp of a simulated conversation. The inbound queue queues a simulation's next step once the whole reply
   * (every message of it) is stored; demo phones have no simulation row.
   */
  export const forConversation = (_db: DbClient, _conversationId: string): Promise<WhatsAppProvider> =>
    Promise.resolve(noop);
}
