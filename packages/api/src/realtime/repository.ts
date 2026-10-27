import type { RealtimeDbClient } from '../realtime-db';

import { CONNECTION_TTL_SECONDS } from './types';

export namespace ConnectionRepository {
  export type RegisterInput = {
    connectionId: string;
    storeId: string;
    userId: string;
    now: Date;
  };

  export const register = async (db: RealtimeDbClient, input: RegisterInput) => {
    const expireAt = Math.floor(input.now.getTime() / 1000) + CONNECTION_TTL_SECONDS;

    await db.connections.upsertOne({
      insert: {
        connection_id: input.connectionId,
        store_id: input.storeId,
        user_id: input.userId,
        created_at: input.now.toISOString(),
        expire_at: expireAt
      },
      update: {
        store_id: input.storeId,
        user_id: input.userId,
        expire_at: expireAt
      },
      where: {
        connection_id: input.connectionId
      }
    });
  };

  export const remove = async (db: RealtimeDbClient, connectionId: string) => {
    await db.connections.deleteOne({
      where: {
        connection_id: connectionId
      }
    });
  };

  export const listByStore = async (db: RealtimeDbClient, storeId: string) => {
    const { records } = await db.connections.findMany({
      select: {
        connection_id: true
      },
      where: {
        store_id: storeId
      }
    });

    return records.map(({ connection_id }) => connection_id);
  };
}
