import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError, postPublic } from '../../lib/api';
import { normalizePhone, savePhoneToken } from '../../lib/phone-token';

const ERROR_TEXT: Record<string, string> = {
  phone: 'Confira o telefone: DDD e número.',
  resend_wait: 'Aguarde para pedir outro código.',
  too_many_codes: 'Muitos códigos para este número agora. Tente de novo mais tarde.',
  code_invalid: 'Código errado. Confira a mensagem no WhatsApp.',
  code_expired: 'Código vencido. Peça um novo.',
  too_many_attempts: 'Muitas tentativas. Peça um novo código.',
  code_send_failed: 'Não conseguimos enviar pelo WhatsApp. Tente de novo.',
  store_closed: 'A loja não está recebendo pedidos agora.'
};

const errorText = (error: unknown) =>
  (error instanceof ApiError && error.field && ERROR_TEXT[error.field]) || 'Não foi possível agora. Tente de novo.';

type Sent = { resend_in_seconds: number; expires_in_seconds: number; local_code: string | null };

/**
 * Seconds left until `until` (ms), ticking every second.
 */
const useCountdown = (until: number) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (until <= Date.now()) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [until]);

  return Math.max(0, Math.ceil((until - now) / 1000));
};

/**
 * Confirms the typed phone with a code sent on WhatsApp (Atendy's number), shown only once the order is ready to send
 * (no code is paid for someone just browsing). It sends the first code by itself. The token is kept in this browser,
 * so the next orders with the same phone skip it.
 */
export function PhoneCheck(props: {
  slug: string;
  phone: string;
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Sent & { phone: string }>();
  const [resendAt, setResendAt] = useState(0);
  const wait = useCountdown(resendAt);
  const phone = normalizePhone(props.phone);
  const path = `/public/stores/${encodeURIComponent(props.slug)}/phone-codes`;

  const send = useMutation({
    mutationFn: () => postPublic<Sent>(path, { phone: props.phone }),
    onSuccess: (result) => {
      setSent({ ...result, phone: phone! });
      setCode('');
      setResendAt(Date.now() + result.resend_in_seconds * 1000);
    }
  });

  // Once per opening (the ref also survives React's dev double effect, so no second code is paid for).
  const started = useRef(false);

  useEffect(() => {
    if (!started.current && phone) {
      started.current = true;
      send.mutate();
    }
  }, [phone, send]);

  const verify = useMutation({
    mutationFn: (typed: string) => postPublic<{ token: string }>(`${path}/verify`, { phone: props.phone, code: typed }),
    onSuccess: ({ token }) => {
      savePhoneToken(props.phone, token);
      props.onToken(token);
    }
  });

  if (!phone) {
    return null;
  }

  // A code sent to another number does not count for this one.
  const waiting = sent?.phone === phone;

  const onCode = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);

    setCode(digits);

    if (digits.length === 6) {
      verify.mutate(digits);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-3">
      {!waiting ? (
        <>
          <p className="text-sm text-neutral-600">Para enviar o pedido, confirme seu WhatsApp com um código.</p>
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="h-11 rounded-lg bg-neutral-900 text-sm font-semibold text-white disabled:opacity-50"
          >
            {send.isPending ? 'Enviando…' : 'Enviar código pelo WhatsApp'}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            Enviamos um código de 6 dígitos para o WhatsApp {props.phone}. Ele vale 10 minutos.
          </p>
          {sent?.local_code && (
            <p className="text-xs text-amber-700">Ambiente local, sem WhatsApp: código {sent?.local_code}</p>
          )}
          <input
            value={code}
            onChange={(event) => onCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Código"
            disabled={verify.isPending}
            className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-center text-lg tracking-[0.4em] focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={wait > 0 || send.isPending}
            className="self-start text-sm font-medium text-accent-fg disabled:text-neutral-400"
          >
            {wait > 0 ? `Reenviar código em ${wait} s` : 'Reenviar código'}
          </button>
        </>
      )}
      {verify.isPending && <p className="text-sm text-neutral-500">Conferindo…</p>}
      {verify.isError && <p className="text-sm text-red-700">{errorText(verify.error)}</p>}
      {send.isError && <p className="text-sm text-red-700">{errorText(send.error)}</p>}
      <button type="button" onClick={props.onCancel} className="self-start text-sm text-neutral-500">
        Voltar ao pedido
      </button>
    </div>
  );
}
