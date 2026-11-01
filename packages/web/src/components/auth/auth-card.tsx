import type { ReactNode } from 'react';

import { Logo } from '../logo';

const STEPS = ['Cadastre a loja', 'Monte o cardápio', 'Conecte o WhatsApp'];

/**
 * Frame of the sign-in screens: orange side panel on desktop, orange header with a sheet over it on phones.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 lg:grid lg:grid-cols-2">
      <aside className="flex flex-col gap-3 bg-accent px-6 pb-9 pt-6 text-white lg:justify-between lg:p-14">
        <Logo mono className="h-6 self-start lg:h-7" />
        <div className="flex max-w-[440px] flex-col gap-4">
          <h2 className="text-balance text-[26px] font-bold leading-tight tracking-tight lg:text-[40px]">
            Seu delivery atendido no WhatsApp<span className="hidden lg:inline">, 24 horas por dia</span>.
          </h2>
          <p className="hidden text-[17px] leading-normal lg:block">
            O bot anota o pedido com o seu cardápio e as suas regras. Você aceita e despacha pelo painel.
          </p>
        </div>
        <ol className="hidden gap-7 text-sm lg:flex">
          {STEPS.map((step, index) => (
            <li key={step} className="flex flex-col gap-0.5">
              <b className="text-[15px]">{index + 1}</b>
              {step}
            </li>
          ))}
        </ol>
      </aside>
      <main className="-mt-4 rounded-t-[20px] bg-neutral-50 px-5 py-6 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:rounded-none lg:p-12">
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-4 lg:gap-5">{children}</div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 lg:gap-1.5">
      <h1 className="text-[22px] font-bold tracking-tight lg:text-[26px]">{title}</h1>
      <p className="text-sm leading-normal text-neutral-500">{children}</p>
    </div>
  );
}
