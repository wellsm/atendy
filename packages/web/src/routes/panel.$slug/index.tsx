import { createFileRoute } from '@tanstack/react-router';

import { ConversationList } from '../../components/conversations/conversation-list';
import { Thread } from '../../components/conversations/thread';
import { Loading } from '../../components/loading';
import { OrderBoard } from '../../components/orders/order-board';
import { BillingSheet } from '../../components/sheets/billing-sheet';
import { DashboardSheet } from '../../components/sheets/dashboard-sheet';
import { HistorySheet } from '../../components/sheets/history-sheet';
import { MenuSheet } from '../../components/sheets/menu-sheet';
import { SettingsSheet } from '../../components/sheets/settings-sheet';
import { StockSheet } from '../../components/sheets/stock-sheet';
import { WhatsAppSheet } from '../../components/sheets/whatsapp-sheet';
import { usePanelNavigate, validatePanelSearch } from '../../lib/panel-search';
import { useConversations, useOrders } from '../../lib/queries';

export const Route = createFileRoute('/panel/$slug/')({
  validateSearch: validatePanelSearch,
  component: PanelPage
});

/**
 * Conversations with their orders in the middle, or the open orders board (`?view=orders`, the kitchen screen); menu, WhatsApp, settings, billing and history open as side sheets.
 * Phone: the list, or the thread when one is open (`?c=`).
 */
function PanelPage() {
  const { view, c: selectedId, sheet } = Route.useSearch();
  const navigate = usePanelNavigate();
  const conversations = useConversations();
  const openOrders = useOrders('open');
  const close = () => navigate({});

  return (
    <>
      {view === 'orders' && openOrders.isPending && <Loading />}

      {view === 'orders' && openOrders.isError && (
        <p className="p-4 text-sm text-accent-fg">Não foi possível carregar os pedidos.</p>
      )}

      {view === 'orders' && openOrders.data && <OrderBoard orders={openOrders.data.orders} />}

      {view !== 'orders' && (
        <section className="flex min-h-0 flex-1">
          <div
            className={`min-h-0 w-full flex-col border-line bg-surface md:flex md:w-[350px] md:shrink-0 md:border-r ${selectedId ? 'hidden' : 'flex'}`}
          >
            {conversations.isPending && <Loading />}

            {conversations.isError && (
              <p className="p-4 text-sm text-accent-fg">Não foi possível carregar as conversas.</p>
            )}

            {conversations.data && (
              <ConversationList
                conversations={conversations.data.conversations}
                openOrders={openOrders.data?.orders ?? []}
                selectedId={selectedId}
              />
            )}
          </div>

          {selectedId ? (
            <Thread key={selectedId} conversationId={selectedId} />
          ) : (
            <div className="hidden flex-1 items-center justify-center bg-chat text-sm text-muted md:flex">
              Escolha uma conversa.
            </div>
          )}
        </section>
      )}

      {sheet === 'menu' && <MenuSheet onClose={close} />}
      {sheet === 'whatsapp' && <WhatsAppSheet onClose={close} />}
      {sheet === 'settings' && <SettingsSheet onClose={close} />}
      {sheet === 'billing' && <BillingSheet onClose={close} />}
      {sheet === 'history' && <HistorySheet onClose={close} />}
      {sheet === 'stock' && <StockSheet onClose={close} />}
      {sheet === 'dashboard' && <DashboardSheet onClose={close} />}
    </>
  );
}
