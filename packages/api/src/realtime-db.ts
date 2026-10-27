import type { DynamoDbEngine } from '@ez4/aws-dynamodb/client';
import type { Client, Database, Index } from '@ez4/database';
import type { ConnectionSchema } from './realtime/schemas/connection';

export type RealtimeDbClient = RealtimeDb['client'];

/**
 * Panel WebSocket connections. DynamoDB because it expires rows by itself (TTL) and takes writes
 * from the socket handlers without a connection pool.
 */
export declare class RealtimeDb extends Database.Service<DynamoDbEngine> {
  client: Client<RealtimeDb>;

  tables: [
    Database.UseTable<{
      name: 'connections';
      schema: ConnectionSchema;
      indexes: {
        connection_id: Index.Primary;
        store_id: Index.Secondary;
        expire_at: Index.TTL;
      };
    }>
  ];
}
