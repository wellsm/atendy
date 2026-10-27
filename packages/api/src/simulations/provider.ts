import type { DbClient } from '../db';
import type { WhatsAppProvider } from '../whatsapp/types';

import { randomUUID } from 'node:crypto';

import { SimulationRepository } from './repository';

export type SimulationStep = {
  simulationId: string;
};

export namespace SimulatorProvider {
  /**
   * WhatsApp of a simulated conversation: nothing leaves the API. The inbound queue queues the simulated customer's next
   * step once the whole reply (every message of it) is stored.
   */
  export const forConversation = async (db: DbClient, conversationId: string): Promise<WhatsAppProvider> => {
    const simulationId = await SimulationRepository.findIdByConversation(db, conversationId);

    if (!simulationId) {
      throw new Error(`No simulation for conversation ${conversationId}`);
    }

    return {
      sendText: () => Promise.resolve({ providerMessageId: `sim:${randomUUID()}` }),
      startTyping: () => () => Promise.resolve(),
      downloadMedia: () => Promise.reject(new Error('Simulated customers send text only'))
    };
  };
}
