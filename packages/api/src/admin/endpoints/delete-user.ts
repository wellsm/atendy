import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminClerkProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { ClerkBackend } from '../../clerk/backend';

export declare class DeleteAdminUserRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    userId: string;
  };
}

export declare class DeleteAdminUserResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

/**
 * Deletes the Clerk login; its stores stay.
 */
export async function deleteAdminUserHandler(
  request: Http.Incoming<DeleteAdminUserRequest>,
  _context: Service.Context<AdminClerkProvider>
): Promise<DeleteAdminUserResponse> {
  const { userId } = request.parameters;

  await ClerkBackend.deleteUser(userId);

  return { status: 200, body: { id: userId } };
}
