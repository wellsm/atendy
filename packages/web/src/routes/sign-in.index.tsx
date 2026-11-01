import type { FormEvent } from 'react';

import { useAuth, useSignIn, useSignUp } from '@clerk/react';
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { AuthHeading, AuthLayout } from '../components/auth/auth-card';
import { Loading } from '../components/loading';
import { authErrorText, goTo, isEmail, isUnknownAccount } from '../lib/auth';

export const Route = createFileRoute('/sign-in/')({
  component: SignInPage
});

const INPUT =
  'w-full rounded-[10px] border bg-white px-3.5 py-3 text-base font-normal focus:border-accent focus:outline-none disabled:bg-neutral-50 lg:text-[15px]';

const inputBorder = (error?: string) => (error ? 'border-red-500' : 'border-neutral-300');

const BUTTON =
  'h-[52px] w-full rounded-xl bg-accent px-4 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50 lg:h-12 lg:rounded-[10px] lg:text-[15px]';

const LINK_BUTTON = 'text-sm text-neutral-600 hover:text-neutral-900';

const RESEND_SECONDS = 30;

/**
 * The account needs a step these screens don't cover (2FA, required fields set in the Clerk dashboard).
 */
const INCOMPLETE_TEXT =
  'Sua conta precisa de uma verificação extra que esta tela ainda não suporta. Fale com o suporte do Atendy.';

type Step = { kind: 'email' } | { kind: 'code'; email: string; flow: 'sign_in' | 'sign_up' };

/**
 * Email + code for both sign-in and sign-up (an unknown email continues as a sign-up), or Google.
 */
function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [step, setStep] = useState<Step>({ kind: 'email' });

  // "Trocar e-mail": a new email starts clean (no stale sign-in or sign-up attempt).
  const backToEmail = async () => {
    await Promise.all([signIn.reset(), signUp.reset()]);
    setStep({ kind: 'email' });
  };

  if (!isLoaded) {
    return <Loading />;
  }

  if (isSignedIn) {
    return <Navigate to="/panel" />;
  }

  return (
    <AuthLayout>
      {step.kind === 'email' ? (
        <EmailStep onCodeSent={(email, flow) => setStep({ kind: 'code', email, flow })} />
      ) : (
        <CodeStep email={step.email} flow={step.flow} onBack={() => void backToEmail()} />
      )}
      {/* Clerk bot protection renders here for custom sign-up flows. */}
      <div id="clerk-captcha" />
    </AuthLayout>
  );
}

/**
 * Sends the code: sign-in first; an unknown email becomes a sign-up with the same email.
 */
const useSendCode = () => {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  return async (email: string): Promise<{ flow: 'sign_in' | 'sign_up' } | { error: unknown }> => {
    const sent = await signIn.emailCode.sendCode({ emailAddress: email });

    if (!sent.error) {
      return { flow: 'sign_in' };
    }

    if (!isUnknownAccount(sent.error)) {
      return { error: sent.error };
    }

    const created = await signUp.create({ emailAddress: email });

    if (created.error) {
      return { error: created.error };
    }

    const signUpSent = await signUp.verifications.sendEmailCode();

    return signUpSent.error ? { error: signUpSent.error } : { flow: 'sign_up' };
  };
};

function EmailStep({ onCodeSent }: { onCodeSent: (email: string, flow: 'sign_in' | 'sign_up') => void }) {
  const { signIn } = useSignIn();
  const sendCode = useSendCode();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!isEmail(email)) {
      setError('E-mail inválido.');

      return;
    }

    setBusy(true);
    setError(undefined);

    const result = await sendCode(email.trim());

    setBusy(false);

    if ('error' in result) {
      setError(authErrorText(result.error));

      return;
    }

    onCodeSent(email.trim(), result.flow);
  };

  const google = async () => {
    setBusy(true);
    setError(undefined);

    // An email attempt left from "Trocar e-mail" (or a reload) would make `sso` a no-op.
    await signIn.reset();

    const { error: ssoError } = await signIn.sso({
      strategy: 'oauth_google',
      redirectUrl: `${window.location.origin}/`,
      redirectCallbackUrl: `${window.location.origin}/sign-in/sso-callback`
    });

    // On success the browser is already leaving for Google.
    if (ssoError) {
      setBusy(false);
      setError(authErrorText(ssoError));
    }
  };

  return (
    <>
      <AuthHeading title="Entrar no Atendy">Primeira vez? Use o mesmo caminho — criamos sua conta.</AuthHeading>

      <button
        type="button"
        disabled={busy}
        onClick={() => void google()}
        className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border border-neutral-300 bg-white text-[15px] font-medium hover:bg-neutral-50 disabled:opacity-50 lg:h-12 lg:rounded-[10px]"
      >
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-full border-2 border-neutral-400 text-[11px] font-bold text-neutral-600"
        >
          G
        </span>
        Continuar com Google
      </button>

      <div className="flex items-center gap-3 text-[13px] text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        ou
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 lg:gap-5">
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="email">
          E-mail
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(undefined);
            }}
            placeholder="voce@sualoja.com.br"
            aria-invalid={!!error}
            className={`${INPUT} ${inputBorder(error)}`}
          />
          {error && <span className="text-[13px] font-normal text-red-700">{error}</span>}
        </label>
        <button type="submit" disabled={busy || !email.trim()} className={BUTTON}>
          {busy ? 'Enviando código…' : 'Continuar com e-mail'}
        </button>
      </form>

      <p className="text-xs leading-normal text-neutral-400">
        Enviaremos um código de 6 dígitos para o seu e-mail. Sem senha.
      </p>
    </>
  );
}

function CodeStep(props: { email: string; flow: 'sign_in' | 'sign_up'; onBack: () => void }) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const sendCode = useSendCode();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [flow, setFlow] = useState(props.flow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);

    return () => clearTimeout(timer);
  }, [cooldown]);

  const finalizeParams = {
    navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) =>
      goTo(decorateUrl('/'), (path) => void navigate({ to: path }))
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const verified =
        flow === 'sign_in'
          ? await signIn.emailCode.verifyCode({ code: code.trim() })
          : await signUp.verifications.verifyEmailCode({ code: code.trim() });

      if (verified.error) {
        setError(authErrorText(verified.error));

        return;
      }

      // Right code but Clerk still needs more (second factor, new device, missing fields): no session to finalize.
      const status = flow === 'sign_in' ? signIn.status : signUp.status;

      if (status !== 'complete') {
        setError(INCOMPLETE_TEXT);

        return;
      }

      const finalized =
        flow === 'sign_in' ? await signIn.finalize(finalizeParams) : await signUp.finalize(finalizeParams);

      if (finalized.error) {
        setError(authErrorText(finalized.error));
      }
    } catch (failure) {
      setError(authErrorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(undefined);
    setCooldown(RESEND_SECONDS);

    const result = await sendCode(props.email);

    if ('error' in result) {
      setError(authErrorText(result.error));

      return;
    }

    setFlow(result.flow);
  };

  return (
    <>
      <button type="button" onClick={props.onBack} className={`${LINK_BUTTON} self-start py-1.5 lg:py-0`}>
        ← Trocar e-mail
      </button>

      <AuthHeading title="Confira seu e-mail">
        Enviamos um código de 6 dígitos para <b className="break-all font-semibold text-neutral-900">{props.email}</b>.
      </AuthHeading>

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 lg:gap-5">
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="code">
          Código
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, ''));
              setError(undefined);
            }}
            placeholder="000000"
            aria-invalid={!!error}
            className={`${INPUT} ${inputBorder(error)} text-center font-mono text-[26px] font-semibold tracking-[0.4em] lg:text-2xl`}
          />
          {error && <span className="text-[13px] font-normal text-red-700">{error}</span>}
        </label>
        <button type="submit" disabled={busy || code.length !== 6} className={BUTTON}>
          {busy ? 'Verificando…' : flow === 'sign_up' ? 'Criar conta' : 'Entrar'}
        </button>
      </form>

      <div className="flex min-h-11 items-center justify-center text-sm text-neutral-500">
        {cooldown > 0 ? (
          <span>Reenviar em {cooldown} s</span>
        ) : (
          <button
            type="button"
            onClick={() => void resend()}
            className="p-2.5 font-medium text-accent-fg hover:text-accent-hover"
          >
            Reenviar código
          </button>
        )}
      </div>
    </>
  );
}
