import type { RealtimeDb } from '../../src/realtime-db';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';
import { WsTester } from '@ez4/local-gateway/test';
import { QueueTester } from '@ez4/local-queue/test';

import { notifyPanel } from '../../src/realtime/notify';
import { panelEventsHandler } from '../../src/realtime/queues/panel-events';
import { ConnectionRepository } from '../../src/realtime/repository';
import { PanelSocketMessageType, PanelTrigger } from '../../src/realtime/types';

describe('panel events', () => {
  const realtimeDb = DatabaseTester.getClient<RealtimeDb>('RealtimeDb');

  const now = new Date();

  const handle = async (message: { storeId: string; triggers: PanelTrigger[]; conversationId?: string }) => {
    const panelSocket = WsTester.getClientMock('PanelSocket');

    await panelEventsHandler({ message } as never, { realtimeDb, panelSocket });

    return panelSocket;
  };

  it("posts to every connection of the store and never to another store's", async () => {
    await ConnectionRepository.register(realtimeDb, { connectionId: 'ev-a1', storeId: 'ev-store-a', userId: 'u', now });
    await ConnectionRepository.register(realtimeDb, { connectionId: 'ev-a2', storeId: 'ev-store-a', userId: 'u', now });
    await ConnectionRepository.register(realtimeDb, { connectionId: 'ev-b1', storeId: 'ev-store-b', userId: 'u', now });

    const panelSocket = await handle({
      storeId: 'ev-store-a',
      triggers: [PanelTrigger.Conversations],
      conversationId: 'conv-1'
    });

    const calls = panelSocket.sendMessage.mock.calls.map(({ arguments: [id, body] }) => ({ id, body }));

    deepEqual(
      calls.sort((a, b) => a.id.localeCompare(b.id)),
      ['ev-a1', 'ev-a2'].map((id) => ({
        id,
        body: { type: PanelSocketMessageType.Refresh, triggers: [PanelTrigger.Conversations], conversationId: 'conv-1' }
      }))
    );
  });

  it('does nothing for a store without open panels', async () => {
    const panelSocket = await handle({ storeId: 'ev-store-empty', triggers: [PanelTrigger.Orders] });

    equal(panelSocket.sendMessage.mock.callCount(), 0);
  });

  it('notifyPanel enqueues the event and swallows a queue failure', async () => {
    const panelEvents = QueueTester.getClientMock('PanelEventsQueue');

    await notifyPanel(panelEvents as never, 'ev-store-a', [PanelTrigger.Orders]);

    deepEqual(panelEvents.sendMessage.mock.calls[0]?.arguments, [{ storeId: 'ev-store-a', triggers: ['orders'] }]);

    mock.method(panelEvents, 'sendMessage', () => Promise.reject(new Error('queue down')));

    await notifyPanel(panelEvents as never, 'ev-store-a', [PanelTrigger.Orders]);
  });
});
