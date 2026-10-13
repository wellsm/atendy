import type { Client, Database, Index } from '@ez4/database';
import type { PostgresEngine } from '@ez4/raw-pg/client';
import type { AiCallSchema } from './agent/schemas/ai-call';
import type { ConversationSchema } from './conversations/schemas/conversation';
import type { CustomerSchema } from './conversations/schemas/customer';
import type { MessageSchema } from './conversations/schemas/message';
import type { CategorySchema } from './menu/schemas/category';
import type { OptionSchema } from './menu/schemas/option';
import type { OptionGroupSchema } from './menu/schemas/option-group';
import type { ProductSchema } from './menu/schemas/product';
import type { OrderSchema } from './orders/schemas/order';
import type { OrderItemSchema } from './orders/schemas/order-item';
import type { DeliveryZoneSchema } from './stores/schemas/delivery-zone';
import type { StoreSchema } from './stores/schemas/store';
import type { StoreHourSchema } from './stores/schemas/store-hour';

export type DbClient = Db['client'];

export declare class Db extends Database.Service<PostgresEngine> {
  client: Client<typeof this>;

  tables: [
    {
      name: 'stores';
      schema: StoreSchema;
      indexes: {
        id: Index.Primary;
        slug: Index.Unique;
        clerk_org_id: Index.Unique;
      };
    },
    {
      name: 'store_hours';
      schema: StoreHourSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'delivery_zones';
      schema: DeliveryZoneSchema;
      indexes: {
        id: Index.Primary;
        'store_id:neighborhood': Index.Unique;
      };
    },
    {
      name: 'categories';
      schema: CategorySchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'products';
      schema: ProductSchema;
      indexes: {
        id: Index.Primary;
        'store_id:active': Index.Secondary;
        category_id: Index.Secondary;
      };
    },
    {
      name: 'option_groups';
      schema: OptionGroupSchema;
      indexes: {
        id: Index.Primary;
        product_id: Index.Secondary;
      };
    },
    {
      name: 'options';
      schema: OptionSchema;
      indexes: {
        id: Index.Primary;
        group_id: Index.Secondary;
      };
    },
    {
      name: 'customers';
      schema: CustomerSchema;
      indexes: {
        id: Index.Primary;
        'store_id:phone': Index.Unique;
        'store_id:whatsapp_jid': Index.Secondary;
      };
    },
    {
      name: 'conversations';
      schema: ConversationSchema;
      indexes: {
        id: Index.Primary;
        'store_id:customer_id': Index.Unique;
        'store_id:last_message_at': Index.Secondary;
      };
    },
    {
      name: 'messages';
      schema: MessageSchema;
      indexes: {
        id: Index.Primary;
        'store_id:provider_message_id': Index.Unique;
        'conversation_id:created_at': Index.Secondary;
      };
    },
    {
      name: 'orders';
      schema: OrderSchema;
      indexes: {
        id: Index.Primary;
        'store_id:status': Index.Secondary;
        conversation_id: Index.Secondary;
      };
    },
    {
      name: 'order_items';
      schema: OrderItemSchema;
      indexes: {
        id: Index.Primary;
        order_id: Index.Secondary;
      };
    },
    {
      name: 'ai_calls';
      schema: AiCallSchema;
      indexes: {
        id: Index.Primary;
        'store_id:created_at': Index.Secondary;
        conversation_id: Index.Secondary;
      };
    }
  ];
}
