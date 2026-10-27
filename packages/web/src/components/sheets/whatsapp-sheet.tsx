import type { WhatsAppHooks } from '../whatsapp-connect';

import { Sheet, SheetHeader } from './sheet';
import { useConnectWhatsApp, useDisconnectWhatsApp, useWhatsAppState } from '../../lib/queries';
import { WhatsAppConnect } from '../whatsapp-connect';

const HOOKS: WhatsAppHooks = {
  useState: useWhatsAppState,
  useConnect: useConnectWhatsApp,
  useDisconnect: useDisconnectWhatsApp
};

export function WhatsAppSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet width="sm" label="WhatsApp" onClose={onClose}>
      <SheetHeader title="WhatsApp" onClose={onClose} />
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-6">
        <WhatsAppConnect hooks={HOOKS} />

        <p className="text-xs leading-normal text-muted">
          A conexão usa o WhatsApp do celular (não oficial), conforme o aviso aceito no cadastro. Use um número dedicado
          à loja.
        </p>
      </div>
    </Sheet>
  );
}
