import type { Http } from '@ez4/gateway';
import type { panelAuthorizer } from '../panel/authorizer';
import type { archiveStockItemHandler } from './endpoints/archive-item';
import type { createStockCountsHandler } from './endpoints/create-counts';
import type { createStockEntryHandler } from './endpoints/create-entry';
import type { createStockItemHandler } from './endpoints/create-item';
import type { createStockLossHandler } from './endpoints/create-loss';
import type { findStockBarcodeHandler } from './endpoints/find-barcode';
import type { getStockItemHandler } from './endpoints/get-item';
import type { getProductStockLinksHandler } from './endpoints/get-product-links';
import type { getStockSummaryHandler } from './endpoints/get-summary';
import type { listStockItemsHandler } from './endpoints/list-items';
import type { listStockMovementsHandler } from './endpoints/list-movements';
import type { setOptionStockLinksHandler } from './endpoints/set-option-links';
import type { setProductStockLinksHandler } from './endpoints/set-product-links';
import type { updateStockItemHandler } from './endpoints/update-item';

export type StockRoutes = [
  Http.UseRoute<{
    path: 'GET /panel/stock/items';
    authorizer: typeof panelAuthorizer;
    handler: typeof listStockItemsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/stock/summary';
    authorizer: typeof panelAuthorizer;
    handler: typeof getStockSummaryHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/stock/items';
    authorizer: typeof panelAuthorizer;
    handler: typeof createStockItemHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/stock/items/{itemId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof getStockItemHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/stock/items/{itemId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateStockItemHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/stock/items/{itemId}/archive';
    authorizer: typeof panelAuthorizer;
    handler: typeof archiveStockItemHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/stock/items/{itemId}/movements';
    authorizer: typeof panelAuthorizer;
    handler: typeof listStockMovementsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/stock/barcode/{code}';
    authorizer: typeof panelAuthorizer;
    handler: typeof findStockBarcodeHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/stock/entries';
    authorizer: typeof panelAuthorizer;
    handler: typeof createStockEntryHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/stock/losses';
    authorizer: typeof panelAuthorizer;
    handler: typeof createStockLossHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/stock/counts';
    authorizer: typeof panelAuthorizer;
    handler: typeof createStockCountsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/menu/products/{productId}/stock-links';
    authorizer: typeof panelAuthorizer;
    handler: typeof getProductStockLinksHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/menu/products/{productId}/stock-links';
    authorizer: typeof panelAuthorizer;
    handler: typeof setProductStockLinksHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/menu/options/{optionId}/stock-links';
    authorizer: typeof panelAuthorizer;
    handler: typeof setOptionStockLinksHandler;
  }>
];
