const STORAGE_KEY = 'atendy:phone-tokens';

/**
 * Same rule as the API's `normalizePhone`: `55` + DDD + number, or undefined.
 */
export const normalizePhone = (typed: string) => {
  const digits = typed.replace(/\D/g, '');
  const national = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;

  return national.length === 10 || national.length === 11 ? `55${national}` : undefined;
};

const readAll = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

const writeAll = (tokens: Record<string, string>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Private mode: the code is asked again next time.
  }
};

/**
 * The "phone verified" token this browser keeps for the typed phone (every store), while it has not expired. The API
 * checks the signature; here only the expiry (`<phone>.<epoch s>.<signature>`) is read.
 */
export const readPhoneToken = (typed: string) => {
  const phone = normalizePhone(typed);
  const token = phone ? readAll()[phone] : undefined;
  const expires = Number(token?.split('.')[1]);

  return token && expires * 1000 > Date.now() ? token : undefined;
};

export const savePhoneToken = (typed: string, token: string | undefined) => {
  const phone = normalizePhone(typed);

  if (!phone) {
    return;
  }

  const { [phone]: _previous, ...others } = readAll();

  writeAll(token ? { ...others, [phone]: token } : others);
};

/**
 * The phone confirmed most recently in this browser (longest validity left), for "Meus pedidos"; undefined when none.
 */
export const latestPhoneToken = () =>
  Object.entries(readAll())
    .map(([phone, token]) => ({ phone, token, expires: Number(token.split('.')[1]) * 1000 }))
    .filter(({ expires }) => expires > Date.now())
    .sort((a, b) => b.expires - a.expires)[0];
