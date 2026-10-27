import type { Http } from '@ez4/gateway';
import type { createWebOrderHandler } from './endpoints/create-order';
import type { getStorefrontHandler } from './endpoints/get-store';
import type { listMyOrdersHandler } from './endpoints/list-my-orders';
import type { quoteWebOrderHandler } from './endpoints/quote-order';
import type { sendPhoneCodeHandler } from './endpoints/send-phone-code';
import type { verifyPhoneCodeHandler } from './endpoints/verify-phone-code';

export type StorefrontRoutes = [
  Http.UseRoute<{
    path: 'GET /public/stores/{slug}';
    handler: typeof getStorefrontHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /public/stores/{slug}/quote';
    handler: typeof quoteWebOrderHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /public/stores/{slug}/orders';
    handler: typeof createWebOrderHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /public/stores/{slug}/phone-codes';
    handler: typeof sendPhoneCodeHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /public/stores/{slug}/phone-codes/verify';
    handler: typeof verifyPhoneCodeHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /public/stores/{slug}/my-orders';
    handler: typeof listMyOrdersHandler;
  }>
];
