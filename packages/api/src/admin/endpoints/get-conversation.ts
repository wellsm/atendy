import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ConversationSimulation } from '../../simulations/types';
import type { AdminProvider } from '../provider';
import type { AdminAiCall, AdminConversation, AdminIdentity, AdminMessage } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { SimulationRepository } from '../../simulations/repository';
import { InspectorRepository } from '../conversations/repository';

export declare class GetConversationRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    conversationId: String.UUID;
  };
}

export declare class GetConversationResponse implements Http.Response {
  status: 200;
  body: {
    conversation: AdminConversation;
    messages: AdminMessage[];
    aiCalls: AdminAiCall[];
    /**
     * Set when the conversation came from a simulation run.
     */
    simulation: ConversationSimulation | null;
  };
}

/**
 * Timeline of one conversation of any store: messages and AI calls (with prompt version and tools), oldest first,
 * plus the simulation that produced it, if any.
 */
export async function getAdminConversationHandler(
  request: Http.Incoming<GetConversationRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<GetConversationResponse> {
  const { conversationId } = request.parameters;

  const [detail, simulation] = await Promise.all([
    InspectorRepository.get(db, conversationId),
    SimulationRepository.findByConversation(db, conversationId)
  ]);

  if (!detail) {
    throw new HttpNotFoundError('Conversation not found.');
  }

  return { status: 200, body: { ...detail, simulation: simulation ?? null } };
}
