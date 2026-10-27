import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { StorefrontPhoneProvider } from '../provider';

import { HttpNotFoundError } from '@ez4/gateway';

import { verifyPhoneCode } from '../phone-code';
import { withWebOrderErrors } from '../web-errors';
import { requireOrderingStore } from '../web-order';

export declare class VerifyPhoneCodeRequest implements Http.Request {
  parameters: {
    slug: string;
  };
  body: {
    phone: String.Size<8, 20>;
    code: String.Size<6, 6>;
  };
}

export declare class VerifyPhoneCodeResponse implements Http.Response {
  status: 200;
  body: {
    /**
     * Kept by the browser: the next orders with this phone skip the code until it expires.
     */
    token: string;
  };
}

/**
 * Checks the code the customer got on WhatsApp.
 */
export async function verifyPhoneCodeHandler(
  request: Http.Incoming<VerifyPhoneCodeRequest>,
  { db }: Service.Context<StorefrontPhoneProvider>
): Promise<VerifyPhoneCodeResponse> {
  return withWebOrderErrors(async () => {
    const store = await requireOrderingStore(db, request.parameters.slug);

    if (!store) {
      throw new HttpNotFoundError('Store not found');
    }

    return { status: 200, body: await verifyPhoneCode(db, store.id, request.body) };
  });
}
