import type { Http } from '@ez4/gateway';
import type { panelAuthorizer } from '../panel/authorizer';
import type { approveStaffActionHandler } from './endpoints/approve-action';
import type { createStaffHandler } from './endpoints/create-staff';
import type { getCourierPendingHandler } from './endpoints/get-courier-pending';
import type { getStaffLockHandler } from './endpoints/get-staff-lock';
import type { listCourierSettlementsHandler } from './endpoints/list-courier-settlements';
import type { listStaffHandler } from './endpoints/list-staff';
import type { regenerateCourierLinkHandler } from './endpoints/regenerate-courier-link';
import type { setStaffPinHandler } from './endpoints/set-staff-pin';
import type { settleCourierHandler } from './endpoints/settle-courier';
import type { unlockOperatorHandler } from './endpoints/unlock-operator';
import type { unlockOwnerHandler } from './endpoints/unlock-owner';
import type { updateStaffHandler } from './endpoints/update-staff';

export type StaffRoutes = [
  Http.UseRoute<{
    path: 'GET /panel/staff';
    authorizer: typeof panelAuthorizer;
    handler: typeof listStaffHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/staff';
    authorizer: typeof panelAuthorizer;
    handler: typeof createStaffHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /panel/staff/{staffId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof updateStaffHandler;
  }>,
  Http.UseRoute<{
    path: 'PUT /panel/staff/{staffId}/pin';
    authorizer: typeof panelAuthorizer;
    handler: typeof setStaffPinHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/staff/{staffId}/courier-link';
    authorizer: typeof panelAuthorizer;
    handler: typeof regenerateCourierLinkHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/staff/lock';
    authorizer: typeof panelAuthorizer;
    handler: typeof getStaffLockHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/staff/unlock';
    authorizer: typeof panelAuthorizer;
    handler: typeof unlockOperatorHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/staff/approvals';
    authorizer: typeof panelAuthorizer;
    handler: typeof approveStaffActionHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/staff/owner-unlock';
    authorizer: typeof panelAuthorizer;
    handler: typeof unlockOwnerHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/couriers/{staffId}/pending';
    authorizer: typeof panelAuthorizer;
    handler: typeof getCourierPendingHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/couriers/{staffId}/settlements';
    authorizer: typeof panelAuthorizer;
    handler: typeof settleCourierHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/couriers/{staffId}/settlements';
    authorizer: typeof panelAuthorizer;
    handler: typeof listCourierSettlementsHandler;
  }>
];
