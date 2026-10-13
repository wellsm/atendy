const TELEGRAM_TIMEOUT_MS = 5000;

/**
 * Best-effort message to the admin Telegram chat. Never throws: a notification must not fail the request that
 * triggered it (the admin panel also lists pending stores). Skipped when `TELEGRAM_BOT_TOKEN` or
 * `TELEGRAM_CHAT_ID` is empty. Never pass customer data.
 */
export const notifyAdmin = async (text: string) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS)
    });
  } catch {
    // Best effort by design (see above).
  }
};
