import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { DeliveryMode, PaymentMethod, RouterType, StorePolicy, WhatsAppProviderType } from '../types';

export interface StoreSchema extends Database.Schema {
  id: String.UUID;
  name: string;
  slug: string;
  timezone: string;
  clerk_org_id?: string | null;
  /**
   * Set by the admin. An inactive store gets no WhatsApp processing (no AI cost).
   */
  active: boolean;
  /**
   * When the owner accepted the unofficial-WhatsApp risk notice during onboarding.
   */
  risk_accepted_at?: String.DateTime | null;
  accepting_orders: boolean;
  router: RouterType;
  llm_model: string;
  whatsapp_provider: WhatsAppProviderType;
  whatsapp_instance?: string | null;
  /**
   * Per-instance Evolution token used to send messages (never the global API key).
   */
  whatsapp_instance_token?: string | null;
  whatsapp_webhook_secret: string;
  delivery_mode: DeliveryMode;
  flat_fee_cents: Integer.Min<0>;
  payment_methods: PaymentMethod[];
  policy?: StorePolicy | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
