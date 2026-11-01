import type { Http } from '@ez4/gateway';
import type { getCourierPageHandler } from './endpoints/get-courier-page';
import type { markDeliveredHandler } from './endpoints/mark-delivered';

export type CourierRoutes = [
  Http.UseRoute<{
    path: 'GET /public/couriers/{token}';
    handler: typeof getCourierPageHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /public/couriers/{token}/orders/{orderId}/delivered';
    handler: typeof markDeliveredHandler;
  }>
];
