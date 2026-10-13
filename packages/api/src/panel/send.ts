import type { DbClient } from '../db';

import { ConversationRepository } from '../conversations/repository';
import { MessageAuthor } from '../conversations/types';
import { EvolutionRequestError } from '../whatsapp/evolution-client';
import { WhatsAppProviders } from '../whatsapp/providers';

/**
 * Nothing was sent: WhatsApp is not connected or rejected the message.
 */
export class StaffSendError extends Error {}

/**
 * Sends a store message from the panel with the same pending-row protection as bot replies, so its webhook echo
 * is claimed instead of read as "staff typed on the phone". Stored as `staff`: the queue's "already replied"
 * check counts only bot rows.
 */
export const sendStaffMessage = async (
  db: DbClient,
  input: { storeId: string; conversationId: string; to: string; text: string }
) => {
  const store = await db.stores.findOne({
    select: { whatsapp_provider: true, whatsapp_instance: true, whatsapp_instance_token: true },
    where: { id: input.storeId }
  });

  if (!store) {
    throw new StaffSendError('Store not found');
  }

  let provider;

  try {
    provider = WhatsAppProviders.forStore(store, process.env);
  } catch {
    throw new StaffSendError('WhatsApp is not connected');
  }

  const pendingId = await ConversationRepository.createPendingOutbound(db, {
    storeId: input.storeId,
    conversationId: input.conversationId,
    body: input.text,
    author: MessageAuthor.Staff
  });

  try {
    const { providerMessageId } = await provider.sendText({ to: input.to, text: input.text });

    await ConversationRepository.confirmOutbound(db, { storeId: input.storeId, pendingId, providerMessageId });
  } catch (error) {
    // The provider answered with an error: nothing was sent. Other failures may have reached WhatsApp, so the
    // pending row stays for the echo to claim.
    if (error instanceof EvolutionRequestError) {
      await ConversationRepository.discardPendingOutbound(db, { storeId: input.storeId, pendingId });

      throw new StaffSendError(error.message);
    }

    throw error;
  }
};
