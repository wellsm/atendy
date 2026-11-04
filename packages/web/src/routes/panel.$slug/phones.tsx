import type { DemoSlot } from '../../lib/demo-phones';

import { useAuth } from '@clerk/react';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import { useState } from 'react';

import { DemoPhone, SlotForm } from '../../components/demo/phone';
import { Loading } from '../../components/loading';
import { loadSlots, MAX_SLOTS, newDemoPhone, saveSlots } from '../../lib/demo-phones';
import { useMe, useMyStores } from '../../lib/queries';

export const Route = createFileRoute('/panel/$slug/phones')({
  component: PhonesPage
});

const NEW = 'new';

/**
 * Demo phones: up to three fake customers talking to the bots of the stores this login belongs to.
 */
function PhonesPage() {
  const { slug } = Route.useParams();
  const { userId } = useAuth();
  const me = useMe();
  const stores = useMyStores();

  if (me.data && !me.data.demo_enabled) {
    return <Navigate to="/panel/$slug" params={{ slug }} />;
  }

  if (!userId || !stores.data) {
    return <Loading />;
  }

  return <Phones key={userId} userId={userId} slug={slug} stores={stores.data} />;
}

function Phones({
  userId,
  slug,
  stores
}: {
  userId: string;
  slug: string;
  stores: NonNullable<ReturnType<typeof useMyStores>['data']>;
}) {
  const [slots, setSlots] = useState(() => loadSlots(userId));
  // The phone shown below `md` (tabs); every phone shows side by side above it.
  const [active, setActive] = useState<string>(() => slots[0]?.id ?? NEW);

  const update = (next: DemoSlot[]) => {
    setSlots(next);
    saveSlots(userId, next);
  };

  const add = (input: { name: string; slug: string }) => {
    const slot = { id: crypto.randomUUID(), phone: newDemoPhone(), ...input };

    update([...slots, slot]);
    setActive(slot.id);
  };

  const replace = (slot: DemoSlot) => update(slots.map((current) => (current.id === slot.id ? slot : current)));

  const remove = (id: string) => {
    const next = slots.filter((slot) => slot.id !== id);

    update(next);
    setActive(next[0]?.id ?? NEW);
  };

  const canAdd = slots.length < MAX_SLOTS;
  const shown = (id: string) => (active === id ? 'flex' : 'hidden md:flex');

  return (
    <div className="min-h-screen bg-page px-4 py-6 text-fg">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link to="/panel/$slug" params={{ slug }} className="text-sm text-accent-fg hover:underline">
              ← Voltar ao painel
            </Link>
            <h1 className="text-2xl font-semibold">Celulares de teste</h1>
            <p className="text-sm text-muted">
              Cada celular é um cliente falso conversando com o bot. Nada passa pelo WhatsApp.
            </p>
          </div>
          <span className="rounded-full bg-warn-bg px-2.5 py-1.5 text-xs font-semibold text-warn-fg">
            Ambiente de teste
          </span>
        </header>

        <nav aria-label="Celulares" className="flex gap-1.5 md:hidden">
          {slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              aria-pressed={active === slot.id}
              onClick={() => setActive(slot.id)}
              className={`h-11 min-w-0 flex-1 truncate rounded-[10px] px-2 text-sm font-semibold ${
                active === slot.id ? 'bg-accent text-white' : 'border border-line-2 bg-surface'
              }`}
            >
              {slot.name}
            </button>
          ))}
          {canAdd && (
            <button
              type="button"
              aria-pressed={active === NEW}
              onClick={() => setActive(NEW)}
              className={`h-11 min-w-0 flex-1 rounded-[10px] px-2 text-sm ${
                active === NEW
                  ? 'bg-accent font-semibold text-white'
                  : 'border border-dashed border-line-2 bg-surface text-muted'
              }`}
            >
              + Novo
            </button>
          )}
        </nav>

        <div className="flex flex-wrap justify-center gap-6">
          {slots.map((slot) => (
            <div key={slot.id} className={`${shown(slot.id)} w-full max-w-[360px] justify-center`}>
              <DemoPhone
                slot={slot}
                stores={stores}
                onChange={replace}
                onRestart={(input) => replace({ ...slot, ...input, phone: newDemoPhone() })}
                onRemove={() => remove(slot.id)}
              />
            </div>
          ))}
          {canAdd && (
            <div className={`${shown(NEW)} w-full max-w-[360px] justify-center`}>
              <section
                aria-label="Novo celular"
                className="flex h-[640px] w-full max-w-[360px] rounded-[36px] bg-neutral-900 p-2.5 md:h-[720px]"
              >
                <SlotForm key={slots.length} stores={stores} initial={{ name: '', slug }} onSave={add} />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
