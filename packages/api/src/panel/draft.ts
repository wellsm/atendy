import type { DbClient } from '../db';
import type { DraftScope } from '../orders/repository';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { ConversationRepository } from '../conversations/repository';
import { ConversationMode } from '../conversations/types';
import { PricingError } from '../orders/pricing';
import { OrderError } from '../orders/repository';

/**
 * The draft scope of a conversation a person handles. In bot mode the bot owns the draft: 409.
 */
export const requireStaffDraft = async (db: DbClient, storeId: string, conversationId: string): Promise<DraftScope> => {
  const conversation = await ConversationRepository.findForStore(db, storeId, conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  if (conversation.mode !== ConversationMode.Human) {
    throw new HttpConflictError('Take the conversation over before editing its order');
  }

  return { storeId, conversationId, customerId: conversation.customer_id };
};

/**
 * Runs an order write for the attendant; order and pricing errors become a 400 whose `field` is the error code.
 */
export const withOrderErrors = async <T>(write: () => Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof OrderError || error instanceof PricingError) {
      throw new HttpBadRequestError(error.message, { field: error.code });
    }

    throw error;
  }
};
