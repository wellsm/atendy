import type { Client, Database, Index } from '@ez4/database';
import type { PostgresEngine } from '@ez4/raw-pg/client';
import type { AiCallSchema } from './agent/schemas/ai-call';
import type { BillingRecordSchema } from './billing/schemas/billing-record';
import type { CashMovementSchema } from './cash/schemas/cash-movement';
import type { CashSessionSchema } from './cash/schemas/cash-session';
import type { ConversationSchema } from './conversations/schemas/conversation';
import type { CustomerSchema } from './conversations/schemas/customer';
import type { MessageSchema } from './conversations/schemas/message';
import type { CategorySchema } from './menu/schemas/category';
import type { OptionSchema } from './menu/schemas/option';
import type { OptionGroupSchema } from './menu/schemas/option-group';
import type { ProductSchema } from './menu/schemas/product';
import type { ProductGroupSchema } from './menu/schemas/product-group';
import type { OrderSchema } from './orders/schemas/order';
import type { OrderItemSchema } from './orders/schemas/order-item';
import type { BillingInvoiceSchema } from './payments/schemas/billing-invoice';
import type { OrderPaymentSchema } from './pos/schemas/order-payment';
import type { ProspectImportSchema } from './prospecting/schemas/import';
import type { ProspectLeadSchema } from './prospecting/schemas/lead';
import type { ProspectingSenderSchema } from './prospecting/schemas/sender';
import type { SimulationSchema } from './simulations/schemas/simulation';
import type { SimulationRunSchema } from './simulations/schemas/simulation-run';
import type { CourierMessageSchema } from './staff/schemas/courier-message';
import type { CourierSettlementSchema } from './staff/schemas/courier-settlement';
import type { StaffSchema } from './staff/schemas/staff';
import type { StockItemSchema } from './stock/schemas/stock-item';
import type { StockLinkSchema } from './stock/schemas/stock-link';
import type { StockMovementSchema } from './stock/schemas/stock-movement';
import type { StockPackageSchema } from './stock/schemas/stock-package';
import type { PhoneVerificationSchema } from './storefront/schemas/phone-verification';
import type { DeliveryBandSchema } from './stores/schemas/delivery-band';
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
      name: 'delivery_bands';
      schema: DeliveryBandSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
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
      name: 'product_groups';
      schema: ProductGroupSchema;
      indexes: {
        id: Index.Primary;
        'product_id:group_id': Index.Unique;
        group_id: Index.Secondary;
      };
    },
    {
      name: 'stock_items';
      schema: StockItemSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'stock_packages';
      schema: StockPackageSchema;
      indexes: {
        id: Index.Primary;
        stock_item_id: Index.Secondary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'stock_links';
      schema: StockLinkSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
        product_id: Index.Secondary;
        option_id: Index.Secondary;
        stock_item_id: Index.Secondary;
      };
    },
    {
      name: 'stock_movements';
      schema: StockMovementSchema;
      indexes: {
        id: Index.Primary;
        stock_item_id: Index.Secondary;
        order_id: Index.Secondary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'staff';
      schema: StaffSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
        courier_token: Index.Unique;
      };
    },
    {
      name: 'courier_settlements';
      schema: CourierSettlementSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
        courier_id: Index.Secondary;
      };
    },
    {
      name: 'courier_messages';
      schema: CourierMessageSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'cash_sessions';
      schema: CashSessionSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
      };
    },
    {
      name: 'cash_movements';
      schema: CashMovementSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
        session_id: Index.Secondary;
        order_id: Index.Secondary;
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
        'store_id:code': Index.Secondary;
        conversation_id: Index.Secondary;
        courier_id: Index.Secondary;
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
      name: 'order_payments';
      schema: OrderPaymentSchema;
      indexes: {
        id: Index.Primary;
        store_id: Index.Secondary;
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
    },
    {
      name: 'billing_records';
      schema: BillingRecordSchema;
      indexes: {
        id: Index.Primary;
        'store_id:created_at': Index.Secondary;
        conversation_id: Index.Secondary;
        order_id: Index.Secondary;
      };
    },
    {
      name: 'simulation_runs';
      schema: SimulationRunSchema;
      indexes: {
        id: Index.Primary;
        created_at: Index.Secondary;
      };
    },
    {
      name: 'simulations';
      schema: SimulationSchema;
      indexes: {
        id: Index.Primary;
        run_id: Index.Secondary;
        conversation_id: Index.Secondary;
      };
    },
    {
      name: 'billing_invoices';
      schema: BillingInvoiceSchema;
      indexes: {
        id: Index.Primary;
        'store_id:period_start': Index.Unique;
        asaas_payment_id: Index.Secondary;
        'status:due_date': Index.Secondary;
      };
    },
    {
      name: 'phone_verifications';
      schema: PhoneVerificationSchema;
      indexes: {
        id: Index.Primary;
        'phone:created_at': Index.Secondary;
        'ip_hash:created_at': Index.Secondary;
        message_id: Index.Secondary;
      };
    },
    {
      name: 'prospecting_sender';
      schema: ProspectingSenderSchema;
      indexes: {
        id: Index.Primary;
      };
    },
    {
      name: 'prospect_imports';
      schema: ProspectImportSchema;
      indexes: {
        id: Index.Primary;
        created_at: Index.Secondary;
      };
    },
    {
      name: 'prospect_leads';
      schema: ProspectLeadSchema;
      indexes: {
        id: Index.Primary;
        phone: Index.Unique;
        provider_message_id: Index.Secondary;
        'status:position': Index.Secondary;
        'status:queued_at': Index.Secondary;
        import_id: Index.Secondary;
      };
    }
  ];
}
