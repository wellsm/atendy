/**
 * Clerk error code of a failed sign-in/sign-up call (`errors[0].code` on API errors), when there is one.
 */
export const clerkErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { errors, code } = error as { errors?: { code?: unknown }[]; code?: unknown };
  const first = Array.isArray(errors) ? errors[0]?.code : undefined;

  return typeof first === 'string' ? first : typeof code === 'string' ? code : undefined;
};

/**
 * Unknown email on sign-in: the flow continues as a sign-up with the same email.
 */
export const isUnknownAccount = (error: unknown) => clerkErrorCode(error) === 'form_identifier_not_found';

const ERROR_TEXT: Record<string, string> = {
  form_code_incorrect: 'Código incorreto. Confira e tente de novo.',
  verification_expired: 'O código expirou. Peça um novo.',
  verification_failed: 'Muitas tentativas com código errado. Peça um novo código.',
  too_many_requests: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  form_param_format_invalid: 'E-mail inválido.',
  form_identifier_invalid: 'E-mail inválido.',
  captcha_invalid: 'Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.',
  captcha_missing_token: 'Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.',
  oauth_access_denied: 'O login com Google foi cancelado.'
};

/**
 * Portuguese text for a Clerk error; Clerk's own messages are English.
 */
export const authErrorText = (error: unknown) =>
  ERROR_TEXT[clerkErrorCode(error) ?? ''] ?? 'Não foi possível continuar. Tente novamente.';

export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Follows Clerk's decorated URL: an absolute one needs a full page load (Safari cookie refresh).
 */
export const goTo = (url: string, navigate: (path: string) => void) => {
  if (url.startsWith('http')) {
    window.location.href = url;

    return;
  }

  navigate(url);
};
