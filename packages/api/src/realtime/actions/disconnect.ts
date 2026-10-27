import type { Service } from '@ez4/common';
import type { Ws } from '@ez4/gateway';
import type { PanelSocket } from '../../socket';

import { ConnectionRepository } from '../repository';

export async function panelSocketDisconnectHandler(
  event: Ws.Incoming<Ws.EmptyEvent>,
  { realtimeDb }: Service.Context<PanelSocket>
) {
  await ConnectionRepository.remove(realtimeDb, event.connectionId);
}
