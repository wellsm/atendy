import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { StorefrontPhoneProvider } from '../provider';

import { HttpNotFoundError } from '@ez4/gateway';

import { callerIp, CODE_TTL_SECONDS, RESEND_WAIT_SECONDS, sendPhoneCode } from '../phone-code';
import { withWebOrderErrors } from '../web-errors';
import { requireOrderingStore } from '../web-order';
import { isLocalOtp, sendOtpWithWhatsApp } from '../whatsapp-otp';

export declare class SendPhoneCodeRequest implements Http.Request {
  headers: {
    /**
     * Set by API Gateway (caller IP last): per-IP limit.
     */
    'x-forwarded-for'?: string;
  };
  parameters: {
    slug: string;
  };
  body: {
    phone: String.Size<8, 20>;
  };
}

export declare class SendPhoneCodeResponse implements Http.Response {
  status: 201;
  body: {
    resendInSeconds: number;
    expiresInSeconds: number;
    /**
     * Only when `WHATSAPP_OTP_PHONE_ID` is `local` (no WhatsApp): the checkout shows it.
     */
    localCode: string | null;
  };
}

/**
 * Sends the checkout's WhatsApp code from Atendy's number (only while the store takes orders).
 */
export async function sendPhoneCodeHandler(
  request: Http.Incoming<SendPhoneCodeRequest>,
  { db }: Service.Context<StorefrontPhoneProvider>
): Promise<SendPhoneCodeResponse> {
  return withWebOrderErrors(async () => {
    const store = await requireOrderingStore(db, request.parameters.slug);

    if (!store) {
      throw new HttpNotFoundError('Store not found');
    }

    const local = isLocalOtp();

    const { code } = await sendPhoneCode(
      db,
      store.id,
      { phone: request.body.phone, ip: callerIp(request.headers?.['x-forwarded-for']) },
      local ? () => Promise.resolve(undefined) : sendOtpWithWhatsApp
    );

    return {
      status: 201,
      body: { resendInSeconds: RESEND_WAIT_SECONDS, expiresInSeconds: CODE_TTL_SECONDS, localCode: local ? code : null }
    };
  });
}
