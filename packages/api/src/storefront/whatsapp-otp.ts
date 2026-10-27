const GRAPH_URL = 'https://graph.facebook.com/v23.0';

/**
 * Meta authentication template (pt_BR): body `{{1}}` is the code, button 0 copies it.
 */
export const OTP_TEMPLATE = 'otp_code_pt_br_v1';

/**
 * `WHATSAPP_OTP_PHONE_ID` value that skips WhatsApp (local dev): the code goes back to the checkout instead.
 */
export const LOCAL_OTP_PHONE_ID = 'local';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Meta did not take the message (token, template, number or network). Never carries the code or the token.
 */
export class OtpSendError extends Error {}

export const isLocalOtp = () => process.env.WHATSAPP_OTP_PHONE_ID === LOCAL_OTP_PHONE_ID;

/**
 * Sends the code from Atendy's own WhatsApp Cloud API number (never a store's number: no block risk for stores).
 * Returns Meta's message id: delivery (or failure) arrives later on the webhook with it.
 */
export const sendOtpWithWhatsApp = async (phone: string, code: string) => {
  const { WHATSAPP_OTP_PHONE_ID: phoneId, WHATSAPP_OTP_TOKEN: token } = process.env;

  if (!phoneId || !token) {
    throw new OtpSendError('WHATSAPP_OTP_PHONE_ID or WHATSAPP_OTP_TOKEN is not set');
  }

  let response: Response;

  try {
    response = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'template',
        template: {
          name: OTP_TEMPLATE,
          language: { code: 'pt_BR' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }
          ]
        }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new OtpSendError('WhatsApp Cloud API unreachable');
  }

  if (!response.ok) {
    // Meta's reason (code + details) has no token or code in it: keep it for the logs.
    const body = (await response.json().catch(() => undefined)) as
      { error?: { code?: number; message?: string; error_data?: { details?: string } } } | undefined;

    const reason = [body?.error?.code, body?.error?.error_data?.details ?? body?.error?.message]
      .filter(Boolean)
      .join(' ');

    throw new OtpSendError(`WhatsApp Cloud API answered ${response.status}${reason ? `: ${reason}` : ''}`);
  }

  const sent = (await response.json().catch(() => undefined)) as { messages?: { id?: string }[] } | undefined;

  return sent?.messages?.[0]?.id;
};
