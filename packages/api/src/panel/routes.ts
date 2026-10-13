import type { Http } from '@ez4/gateway';
import type { panelAuthorizer } from './authorizer';
import type { connectWhatsAppHandler } from './endpoints/connect-whatsapp';
import type { createCategoryHandler } from './endpoints/create-category';
import type { createProductHandler } from './endpoints/create-product';
import type { createStoreHandler } from './endpoints/create-store';
import type { deleteCategoryHandler } from './endpoints/delete-category';
import type { deleteProductHandler } from './endpoints/delete-product';
import type { disconnectWhatsAppHandler } from './endpoints/disconnect-whatsapp';
import type { getConversationHandler } from './endpoints/get-conversation';
import type { getMeHandler } from './endpoints/get-me';
import type { getMenuHandler } from './endpoints/get-menu';
import type { getSettingsHandler } from './endpoints/get-settings';
import type { getWhatsAppHandler } from './endpoints/get-whatsapp';
import type { listConversationsHandler } from './endpoints/list-conversations';
import type { listOrdersHandler } from './endpoints/list-orders';
import type { renameCategoryHandler } from './endpoints/rename-category';
import type { reorderCategoriesHandler } from './endpoints/reorder-categories';
import type { sendMessageHandler } from './endpoints/send-message';
import type { setOptionActiveHandler } from './endpoints/set-option-active';
import type { setProductActiveHandler } from './endpoints/set-product-active';
import type { updateConversationHandler } from './endpoints/update-conversation';
import type { updateDeliveryHandler } from './endpoints/update-delivery';
import type { updateHoursHandler } from './endpoints/update-hours';
import type { updateOrderHandler } from './endpoints/update-order';
import type { updatePaymentHandler } from './endpoints/update-payment';
import type { updatePolicyHandler } from './endpoints/update-policy';
import type { updateProductHandler } from './endpoints/update-product';
import type { updateStoreHandler } from './endpoints/update-store';

export type PanelRoutes = [
  Http.UseRoute<{
    path: 'GET /panel/me';
    authorizer: typeof panelAuthorizer;
    handler: typeof getMeHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/stores';
    authorizer: typeof panelAuthorizer;
    handler: typeof createStoreHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/store';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateStoreHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/settings';
    authorizer: typeof panelAuthorizer;
    handler: typeof getSettingsHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/settings/hours';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateHoursHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/settings/delivery';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateDeliveryHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/settings/payment';
    authorizer: typeof panelAuthorizer;
    handler: typeof updatePaymentHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/settings/policy';
    authorizer: typeof panelAuthorizer;
    handler: typeof updatePolicyHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/orders';
    authorizer: typeof panelAuthorizer;
    handler: typeof listOrdersHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/orders/{orderId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateOrderHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/conversations';
    authorizer: typeof panelAuthorizer;
    handler: typeof listConversationsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/conversations/{conversationId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof getConversationHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/conversations/{conversationId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateConversationHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/conversations/{conversationId}/messages';
    authorizer: typeof panelAuthorizer;
    handler: typeof sendMessageHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/whatsapp';
    authorizer: typeof panelAuthorizer;
    handler: typeof getWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/whatsapp/connect';
    authorizer: typeof panelAuthorizer;
    handler: typeof connectWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/whatsapp/disconnect';
    authorizer: typeof panelAuthorizer;
    handler: typeof disconnectWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/menu';
    authorizer: typeof panelAuthorizer;
    handler: typeof getMenuHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/menu/categories';
    authorizer: typeof panelAuthorizer;
    handler: typeof createCategoryHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/menu/categories/{categoryId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof renameCategoryHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/menu/categories/order';
    authorizer: typeof panelAuthorizer;
    handler: typeof reorderCategoriesHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/menu/categories/{categoryId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof deleteCategoryHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/menu/products';
    authorizer: typeof panelAuthorizer;
    handler: typeof createProductHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/menu/products/{productId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateProductHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/menu/products/{productId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof deleteProductHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/menu/products/{productId}/active';
    authorizer: typeof panelAuthorizer;
    handler: typeof setProductActiveHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/menu/options/{optionId}/active';
    authorizer: typeof panelAuthorizer;
    handler: typeof setOptionActiveHandler;
  }>
];
