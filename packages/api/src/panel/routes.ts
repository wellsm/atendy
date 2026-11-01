import type { Http } from '@ez4/gateway';
import type { panelAuthorizer } from './authorizer';
import type { addDraftItemHandler } from './endpoints/add-draft-item';
import type { applyMenuGroupHandler } from './endpoints/apply-group';
import type { approveConversationHandler } from './endpoints/approve-conversation';
import type { assignCourierHandler } from './endpoints/assign-courier';
import type { completeImageHandler } from './endpoints/complete-image';
import type { connectWhatsAppHandler } from './endpoints/connect-whatsapp';
import type { createCategoryHandler } from './endpoints/create-category';
import type { createProductHandler } from './endpoints/create-product';
import type { createStoreHandler } from './endpoints/create-store';
import type { deleteCategoryHandler } from './endpoints/delete-category';
import type { deleteMenuGroupHandler } from './endpoints/delete-group';
import type { deleteImageHandler } from './endpoints/delete-image';
import type { deleteProductHandler } from './endpoints/delete-product';
import type { disconnectWhatsAppHandler } from './endpoints/disconnect-whatsapp';
import type { getBillingHandler } from './endpoints/get-billing';
import type { getConversationHandler } from './endpoints/get-conversation';
import type { getDashboardHandler } from './endpoints/get-dashboard';
import type { getDraftHandler } from './endpoints/get-draft';
import type { getMeHandler } from './endpoints/get-me';
import type { getMenuHandler } from './endpoints/get-menu';
import type { getSettingsHandler } from './endpoints/get-settings';
import type { getWhatsAppHandler } from './endpoints/get-whatsapp';
import type { listConversationsHandler } from './endpoints/list-conversations';
import type { listOrdersHandler } from './endpoints/list-orders';
import type { listPanelStoresHandler } from './endpoints/list-stores';
import type { placeDraftHandler } from './endpoints/place-draft';
import type { removeDraftItemHandler } from './endpoints/remove-draft-item';
import type { renameCategoryHandler } from './endpoints/rename-category';
import type { reorderCategoriesHandler } from './endpoints/reorder-categories';
import type { sendMessageHandler } from './endpoints/send-message';
import type { setOptionActiveHandler } from './endpoints/set-option-active';
import type { setProductActiveHandler } from './endpoints/set-product-active';
import type { startImageHandler } from './endpoints/start-image';
import type { updateBillingCardHandler } from './endpoints/update-billing-card';
import type { updateCategoryPreparationHandler } from './endpoints/update-category-preparation';
import type { updateConversationHandler } from './endpoints/update-conversation';
import type { updateDeliveryHandler } from './endpoints/update-delivery';
import type { updateDraftHandler } from './endpoints/update-draft';
import type { updateMenuGroupHandler } from './endpoints/update-group';
import type { updateHoursHandler } from './endpoints/update-hours';
import type { updateOrderHandler } from './endpoints/update-order';
import type { updatePaymentHandler } from './endpoints/update-payment';
import type { updatePolicyHandler } from './endpoints/update-policy';
import type { updatePosSettingsHandler } from './endpoints/update-pos-settings';
import type { updateProductHandler } from './endpoints/update-product';
import type { updateStaffSettingsHandler } from './endpoints/update-staff-settings';
import type { updateStockAlertHandler } from './endpoints/update-stock-alert';
import type { updateStoreHandler } from './endpoints/update-store';
import type { updateStoreLocationHandler } from './endpoints/update-store-location';
import type { addPosSaleItemHandler } from '../pos/endpoints/add-item';
import type { cancelPosSaleHandler } from '../pos/endpoints/cancel-sale';
import type { createPosSaleHandler } from '../pos/endpoints/create-sale';
import type { discardPosSaleHandler } from '../pos/endpoints/discard-sale';
import type { finalizePosSaleHandler } from '../pos/endpoints/finalize-sale';
import type { findPosBarcodeHandler } from '../pos/endpoints/find-barcode';
import type { getPosMenuHandler } from '../pos/endpoints/get-menu';
import type { getPosSaleHandler } from '../pos/endpoints/get-sale';
import type { listPosSalesHandler } from '../pos/endpoints/list-sales';
import type { removePosSaleItemHandler } from '../pos/endpoints/remove-item';
import type { sendPosReceiptHandler } from '../pos/endpoints/send-receipt';
import type { updatePosSaleItemHandler } from '../pos/endpoints/update-item';
import type { updatePosSaleHandler } from '../pos/endpoints/update-sale';

export type PanelRoutes = [
  Http.UseRoute<{
    path: 'GET /panel/me';
    authorizer: typeof panelAuthorizer;
    handler: typeof getMeHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/stores';
    authorizer: typeof panelAuthorizer;
    handler: typeof listPanelStoresHandler;
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
    path: 'PUT /panel/settings/stock-alert';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateStockAlertHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/settings/pos';
    authorizer: typeof panelAuthorizer;
    handler: typeof updatePosSettingsHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/settings/staff';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateStaffSettingsHandler;
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
    path: 'PUT /panel/orders/{orderId}/courier';
    authorizer: typeof panelAuthorizer;
    handler: typeof assignCourierHandler;
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
    path: 'POST /panel/conversations/{conversationId}/approval';
    authorizer: typeof panelAuthorizer;
    handler: typeof approveConversationHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/dashboard';
    authorizer: typeof panelAuthorizer;
    handler: typeof getDashboardHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/conversations/{conversationId}/draft';
    authorizer: typeof panelAuthorizer;
    handler: typeof getDraftHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/conversations/{conversationId}/draft';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateDraftHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/conversations/{conversationId}/draft/items';
    authorizer: typeof panelAuthorizer;
    handler: typeof addDraftItemHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/conversations/{conversationId}/draft/items/{itemId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof removeDraftItemHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/conversations/{conversationId}/draft/place';
    authorizer: typeof panelAuthorizer;
    handler: typeof placeDraftHandler;
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
    path: 'PUT /panel/menu/categories/{categoryId}/preparation';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateCategoryPreparationHandler;
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
    path: 'POST /panel/menu/{target}/{id}/image/upload';
    authorizer: typeof panelAuthorizer;
    handler: typeof startImageHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/menu/{target}/{id}/image';
    authorizer: typeof panelAuthorizer;
    handler: typeof completeImageHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/menu/{target}/{id}/image';
    authorizer: typeof panelAuthorizer;
    handler: typeof deleteImageHandler;
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
  }>,
  Http.UseRoute<{
    path: 'POST /panel/menu/groups/{groupId}/apply';
    authorizer: typeof panelAuthorizer;
    handler: typeof applyMenuGroupHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/menu/groups/{groupId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateMenuGroupHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/menu/groups/{groupId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof deleteMenuGroupHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/settings/store-location';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateStoreLocationHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/billing';
    authorizer: typeof panelAuthorizer;
    handler: typeof getBillingHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/billing/card';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateBillingCardHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/pos/menu';
    authorizer: typeof panelAuthorizer;
    handler: typeof getPosMenuHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/pos/barcode/{code}';
    authorizer: typeof panelAuthorizer;
    handler: typeof findPosBarcodeHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/pos/sales';
    authorizer: typeof panelAuthorizer;
    handler: typeof listPosSalesHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/pos/sales/{saleId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof createPosSaleHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/pos/sales/{saleId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof getPosSaleHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/pos/sales/{saleId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updatePosSaleHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/pos/sales/{saleId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof discardPosSaleHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/pos/sales/{saleId}/items';
    authorizer: typeof panelAuthorizer;
    handler: typeof addPosSaleItemHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/pos/sales/{saleId}/items/{itemId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updatePosSaleItemHandler;
  }>,
  Http.UseRoute<{
    path: 'DELETE /panel/pos/sales/{saleId}/items/{itemId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof removePosSaleItemHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/pos/sales/{saleId}/finalize';
    authorizer: typeof panelAuthorizer;
    handler: typeof finalizePosSaleHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/pos/sales/{saleId}/cancel';
    authorizer: typeof panelAuthorizer;
    handler: typeof cancelPosSaleHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/pos/sales/{saleId}/receipt';
    authorizer: typeof panelAuthorizer;
    handler: typeof sendPosReceiptHandler;
  }>
];
