import type { WhatsAppCopy } from '../components/whatsapp-connect';

import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';

import { ProspectingImport } from '../components/prospecting-import';
import { ProspectingLeads } from '../components/prospecting-leads';
import { ProspectingSender } from '../components/prospecting-sender';
import { SignedIn } from '../components/signed-in';
import { WhatsAppConnect } from '../components/whatsapp-connect';
import { ApiError } from '../lib/api';
import { prospectingWhatsAppHooks, useProspecting } from '../lib/queries';

export const Route = createFileRoute('/admin/prospecting')({
  component: () => (
    <SignedIn>
      <ProspectingPage />
    </SignedIn>
  )
});

/**
 * The prospecting number only sends first messages; nothing answers on it.
 */
const PROSPECTING_COPY: WhatsAppCopy = {
  headline: {
    connected: 'Número conectado. Os envios de prospecção saem por ele.',
    connecting: 'Escaneie o código com o WhatsApp do celular que vai enviar a prospecção.',
    disconnected: 'O WhatsApp foi desconectado. Os envios ficam parados até você conectar de novo.',
    not_created: 'Conecte o número que vai enviar as mensagens de prospecção.'
  },
  confirmDisconnect: 'Os envios param até você conectar de novo. Desconectar?',
  connectedNote: 'As respostas dos leads chegam no celular deste número.',
  disconnectedNote: 'Nenhuma mensagem de prospecção sai até você conectar de novo e retomar os envios.'
};

function ProspectingPage() {
  const summary = useProspecting();

  // `PROSPECTING_ENABLED=false` on the API: every prospecting route answers 404.
  const off = summary.error instanceof ApiError && summary.error.status === 404;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-sm text-neutral-500">
            ← Lojas
          </Link>
          <h1 className="text-xl font-semibold">Prospecção</h1>
          <p className="text-sm text-neutral-600">
            Primeira mensagem para os leads, enviada devagar pelo número conectado. A conversa continua no seu celular.
          </p>
        </div>
        <UserButton />
      </header>

      {off ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
          A prospecção está desligada neste ambiente (<code>PROSPECTING_ENABLED=false</code> na API). Nada é enviado e
          os leads ficam guardados como estão.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Número</h2>
            <WhatsAppConnect hooks={prospectingWhatsAppHooks} copy={PROSPECTING_COPY} />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Envio</h2>
            <ProspectingSender />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Importar</h2>
            <ProspectingImport />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Leads</h2>
            <ProspectingLeads />
          </section>
        </div>
      )}
    </div>
  );
}
