import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelSendProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';

import { HttpConflictError } from '@ez4/gateway';

import { OrderStatus } from '../../orders/types';
import { requirePosStore } from '../../panel/pos-store';
import { sendStaffMessage, StaffSendError } from '../../panel/send';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { customerConversation } from '../../storefront/web-order';
import { PosError, PosErrorCode } from '../errors';
import { withPosErrors } from '../http-errors';
import { formatPosReceipt } from '../receipt';
import { PosRepository } from '../repository';

export declare class SendPosReceiptRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    saleId: String.UUID;
  };
}

export declare class SendPosReceiptResponse implements Http.Response {
  status: 200;
  body: {
    sent: boolean;
  };
}

const FINALIZED = [OrderStatus.Accepted, OrderStatus.Out, OrderStatus.Done];

/**
 * Sends the text receipt of a finalized sale to the customer's phone through the store's WhatsApp. The sale itself
 * stays out of the conversation (its `conversation_id` is untouched).
 */
export async function sendPosReceiptHandler(
  request: Http.Incoming<SendPosReceiptRequest>,
  { db, panelEvents }: Service.Context<PanelSendProvider>
): Promise<SendPosReceiptResponse> {
  const store = await requirePosStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.PosSell);

  const sale = await withPosErrors(async () => {
    const found = await PosRepository.getSale(db, store.id, request.parameters.saleId);

    if (!FINALIZED.includes(found.status) || !found.customer?.phone) {
      throw new PosError(PosErrorCode.Customer, 'The sale needs to be paid and have a customer phone');
    }

    return found;
  });

  const phone = sale.customer?.phone ?? '';
  const scope = await customerConversation(db, store.id, phone, sale.customer?.name ?? '');
  const customer = await db.customers.findOne({ select: { whatsapp_jid: true }, where: { id: scope.customerId } });

  if (!customer?.whatsapp_jid) {
    throw new HttpConflictError('The customer has no WhatsApp id');
  }

  try {
    await sendStaffMessage(db, {
      storeId: store.id,
      conversationId: scope.conversationId,
      to: customer.whatsapp_jid,
      text: formatPosReceipt(store, sale)
    });
  } catch (error) {
    if (error instanceof StaffSendError) {
      throw new HttpConflictError(error.message);
    }

    throw error;
  }

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Conversations], scope.conversationId);

  return { status: 200, body: { sent: true } };
}
