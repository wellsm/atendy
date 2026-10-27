import type { Service } from '@ez4/common';
import type { Ws } from '@ez4/gateway';
import type { PanelSocket } from '../../socket';
import type { PanelSocketIdentity } from '../types';

import { ConnectionRepository } from '../repository';

declare class PanelSocketConnectEvent implements Ws.Event {
  identity: PanelSocketIdentity;
}

export async function panelSocketConnectHandler(
  event: Ws.Incoming<PanelSocketConnectEvent>,
  { realtimeDb }: Service.Context<PanelSocket>
) {
  const { connectionId, identity } = event;

  await ConnectionRepository.register(realtimeDb, {
    connectionId,
    storeId: identity.storeId,
    userId: identity.userId,
    now: new Date()
  });
}
