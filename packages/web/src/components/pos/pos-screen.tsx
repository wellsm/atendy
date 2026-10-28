import type { PosLayout } from '../../lib/pos';
import type {
  PanelStore,
  PosBarcodeCandidate,
  PosLineInput,
  PosLinePatch,
  PosMenuProduct,
  PosSale,
  PosSaleItem,
  PosSalePatch
} from '../../lib/queries';

import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { CashPanel, OpenCashForm } from './cash-panel';
import { HeldSales } from './held-sales';
import { PaymentStep } from './payment-step';
import { ProductGrid } from './product-grid';
import { SaleHistory } from './sale-history';
import { SalePanel } from './sale-panel';
import { matchProducts, SearchBar } from './search-bar';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { usePanelSlug } from '../../lib/panel-slug';
import { BARCODE, parseScan, readPosLayout, savePosLayout } from '../../lib/pos';
import {
  useAddPosSaleItem,
  useBilling,
  useCashCurrent,
  useCreatePosSale,
  useDiscardPosSale,
  usePosBarcode,
  usePosMenu,
  usePosSale,
  usePosSales,
  useRemovePosSaleItem,
  useSettings,
  useUpdatePosSale,
  useUpdatePosSaleItem
} from '../../lib/queries';
import { usePanelTheme } from '../../lib/theme';
import { Loading } from '../loading';
import { ProductDetails } from '../storefront/product-details';

const ERROR_TEXT: Record<string, string> = {
  discount: 'Desconto inválido.',
  customer: 'Nome ou WhatsApp do cliente inválido.',
  label: 'Etiqueta inválida.',
  not_draft: 'Esta venda já foi finalizada.',
  unknown_product: 'Produto não encontrado ou pausado.'
};

const BUTTON = 'h-9 shrink-0 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover';

type Picking = { product: PosMenuProduct; qty: number; preselected?: Record<string, string[]> };

const GONE_TEXT = 'Esta venda foi finalizada ou descartada em outro aparelho.';

/**
 * Desktop only: on a phone, focusing the field opens the keyboard over the grid.
 */
const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

const isEditable = (element: Element | null) =>
  !!element?.closest('input, textarea, select') || (element instanceof HTMLElement && element.isContentEditable);

/**
 * The counter sale screen: products (grid, or a big search field with the grid behind "Ver produtos") and the
 * current sale. A new sale gets its id here and exists on the server from its first item. Phone: the products, with
 * a sticky "Ver venda" bar that opens the sale full screen.
 */
export function PosScreen({ store }: { store: PanelStore }) {
  usePanelTheme();
  const slug = usePanelSlug();
  const menu = usePosMenu();
  const settings = useSettings();
  const billing = useBilling();
  const cash = useCashCurrent();
  const held = usePosSales();
  const findBarcode = usePosBarcode();
  const createSale = useCreatePosSale();
  const updateSale = useUpdatePosSale();
  const addItem = useAddPosSaleItem();
  const updateItem = useUpdatePosSaleItem();
  const removeItem = useRemovePosSaleItem();
  const discardSale = useDiscardPosSale();

  const [layout, setLayout] = useState<PosLayout | undefined>(() => readPosLayout(slug));
  const [saleId, setSaleIdState] = useState<string>();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string>();
  const [picking, setPicking] = useState<Picking>();
  const [candidates, setCandidates] = useState<{ list: PosBarcodeCandidate[]; qty: number }>();
  const [heldOpen, setHeldOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [blockedByApi, setBlockedByApi] = useState(false);
  const [paying, setPaying] = useState<PosSale>();
  const [sheet, setSheet] = useState<'cash' | 'history'>();
  const searchRef = useRef<HTMLInputElement>(null);
  // Read by quick taps before React re-renders: the sale id and its creation in flight.
  const current = useRef<{ id?: string; created?: Promise<unknown> }>({});
  // Lines added this session for products without options, so another tap grows the line instead of adding one.
  const lineProduct = useRef(new Map<string, string>());

  const sale = usePosSale(saleId);
  const shown = sale.data?.sale;
  const categories = menu.data?.categories ?? [];
  const products = categories.flatMap((category) => category.products);
  const effectiveLayout = layout ?? settings.data?.pos.layout ?? 'grid';
  const blocked = !store.active || !!billing.data?.blocked || blockedByApi;
  const cashClosed = !!settings.data?.pos.cash_control && cash.data?.session === null;
  const count = shown?.items.reduce((total, { qty }) => total + qty, 0) ?? 0;

  const setSaleId = (id: string | undefined) => {
    current.current = { id };
    setSaleIdState(id);
    setSaleOpen(false);
  };

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.field === 'store_blocked') {
      setBlockedByApi(true);

      return;
    }

    setMessage((error instanceof ApiError && error.field && ERROR_TEXT[error.field]) || 'Não foi possível salvar.');
  };

  // Charge (F4 and "Cobrar"): the payment step works on this snapshot of the sale.
  const charge = (next: PosSale) => {
    if (!cashClosed && !blocked) {
      setPaying(next);
    }
  };

  // The current sale went away (discarded or finalized on another device; a failed write refetches it): start a new
  // one. A sale this screen finalizes must be detached before its answer lands here.
  useEffect(() => {
    if ((sale.error instanceof ApiError && sale.error.status === 404) || (shown && shown.status !== 'draft')) {
      setSaleId(undefined);
      setMessage(GONE_TEXT);
    }
  }, [sale.error, shown]);

  const focusSearch = () => isDesktop() && searchRef.current?.focus();

  const ensureSale = async () => {
    if (current.current.id) {
      await current.current.created;

      return current.current.id;
    }

    const id = crypto.randomUUID();
    const created = createSale.mutateAsync({ sale_id: id });

    current.current = { id, created };

    try {
      await created;
    } catch (error) {
      if (current.current.id === id) {
        current.current = {};
      }

      throw error;
    }

    // Only now (reading the sale before it exists answers 404 and drops it), and only if still the current one.
    if (current.current.id === id) {
      setSaleIdState(id);
    }

    return id;
  };

  const addLine = async (product: PosMenuProduct, line: PosLineInput) => {
    setMessage(undefined);

    try {
      const id = await ensureSale();
      const simple = !product.groups.length && !line.notes;
      const same = shown?.items.find(
        (item) => lineProduct.current.get(item.item_id) === product.id && !item.notes && !item.discount
      );

      if (simple && same && shown?.id === id) {
        await updateItem.mutateAsync({
          sale_id: id,
          item_id: same.item_id,
          patch: { qty: Math.min(999, same.qty + line.qty) }
        });

        return;
      }

      const before = new Set(shown?.id === id ? shown.items.map(({ item_id }) => item_id) : []);
      const { sale: next } = await addItem.mutateAsync({ sale_id: id, line });
      const added = next.items.filter(({ item_id }) => !before.has(item_id));

      // More than one new line (quick taps, another device): not sure which is ours, so no growing for it.
      if (simple && added.length === 1) {
        lineProduct.current.set(added[0]!.item_id, product.id);
      }
    } catch (error) {
      fail(error);
    }
  };

  /**
   * A product without options goes straight in; with options the picker opens, unless the scan's preselection
   * already fills every required group.
   */
  const addProduct = (product: PosMenuProduct, qty: number, preselected?: Record<string, string[]>) => {
    const short = product.groups.some((group) => (preselected?.[group.id]?.length ?? 0) < group.min);

    if (!product.groups.length || (preselected && !short)) {
      void addLine(product, {
        product_id: product.id,
        qty,
        selections: Object.entries(preselected ?? {}).map(([group_id, option_ids]) => ({ group_id, option_ids }))
      });

      return;
    }

    setPicking({ product, qty, preselected });
  };

  const addCandidate = (candidate: PosBarcodeCandidate, qty: number) => {
    setCandidates(undefined);
    const product = products.find(({ id }) => id === candidate.product_id);

    if (!product) {
      setMessage('Nenhum produto ligado a esse código.');

      return;
    }

    addProduct(
      product,
      qty,
      candidate.selection ? { [candidate.selection.group_id]: [candidate.selection.option_id] } : {}
    );
  };

  const submitSearch = async (text: string) => {
    const scan = parseScan(text);

    setMessage(undefined);

    if (!scan || blocked) {
      return;
    }

    if (!BARCODE.test(scan.code)) {
      const [first] = matchProducts(products, text);

      if (first) {
        addProduct(first, scan.qty);
      } else {
        setMessage('Nenhum produto encontrado.');
      }

      return;
    }

    try {
      const { candidates: list } = await findBarcode(scan.code);

      if (!list.length) {
        setMessage('Nenhum produto ligado a esse código.');
      } else if (list.length === 1) {
        addCandidate(list[0]!, scan.qty);
      } else {
        setCandidates({ list, qty: scan.qty });
      }
    } catch (error) {
      fail(error);
    }
  };

  const patchLine = (item: PosSaleItem, patch: PosLinePatch | undefined) => {
    if (!shown) {
      return;
    }

    if (!patch) {
      setMessage('Desconto inválido.');

      return;
    }

    setMessage(undefined);
    updateItem.mutate({ sale_id: shown.id, item_id: item.item_id, patch }, { onError: fail });
  };

  const removeLine = (item: PosSaleItem) =>
    shown && removeItem.mutate({ sale_id: shown.id, item_id: item.item_id }, { onError: fail });

  const patchSale = (patch: PosSalePatch | undefined) => {
    if (!shown) {
      return;
    }

    if (!patch) {
      setMessage('Valor inválido.');

      return;
    }

    setMessage(undefined);
    updateSale.mutate({ sale_id: shown.id, patch }, { onError: fail });
  };

  const clearSale = () => {
    if (shown) {
      discardSale.mutate(shown.id, { onError: fail });
    }

    setSaleId(undefined);
  };

  const keys = useRef({ shown, picking, candidates, heldOpen, saleOpen, paying, sheet, charge });

  keys.current = { shown, picking, candidates, heldOpen, saleOpen, paying, sheet, charge };

  // A USB reader types wherever the focus is: after a click on a card or a +/− button, its digits go to the search
  // field (focused before the key lands), so its Enter submits the code instead of clicking that button again.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = keys.current;
      const printable =
        event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;

      if (
        printable &&
        isDesktop() &&
        !state.picking &&
        !state.candidates &&
        !state.heldOpen &&
        !state.paying &&
        !state.sheet &&
        !isEditable(document.activeElement)
      ) {
        searchRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = keys.current;

      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'F4') {
        event.preventDefault();

        if (state.shown?.items.length && !state.picking && !state.paying && !state.sheet) {
          state.charge(state.shown);
        }
      } else if (event.key === 'Escape') {
        // The option picker and the payment step close themselves on Esc.
        if (state.picking || state.paying) {
          return;
        }

        if (state.candidates || state.heldOpen || state.saleOpen || state.sheet) {
          setCandidates(undefined);
          setHeldOpen(false);
          setSaleOpen(false);
          setSheet(undefined);
        } else {
          setQuery('');
          setMessage(undefined);
        }
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (menu.isPending || settings.isPending) {
    return <Loading />;
  }

  const chooseLayout = (next: PosLayout) => {
    setLayout(next);
    savePosLayout(slug, next);
    setShowProducts(false);
  };

  const others = held.data?.sales.filter(({ id }) => id !== saleId) ?? [];

  const salePanel = (
    <SalePanel
      sale={shown}
      wide={effectiveLayout === 'search'}
      disabled={blocked}
      onLinePatch={patchLine}
      onRemove={removeLine}
      onPatch={patchSale}
      onHold={() => setSaleId(undefined)}
      onClear={clearSale}
      onCharge={() => shown && charge(shown)}
      onBack={() => setSaleOpen(false)}
    />
  );

  const saleBox = (wide: boolean) =>
    `${saleOpen ? 'fixed inset-0 z-40 flex' : 'hidden'} ${
      wide
        ? showProducts
          ? 'md:hidden'
          : 'md:static md:flex md:min-h-0 md:flex-1'
        : 'md:static md:flex md:w-96 md:shrink-0 md:border-l md:border-line'
    }`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-fg print:hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-4">
        <Link to="/panel/$slug" params={{ slug }} className={`${BUTTON} flex items-center`}>
          ← Painel
        </Link>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          PDV <span className="font-normal text-muted">· {store.name}</span>
        </p>
        <span className="hidden text-xs text-faint lg:inline">F2 buscar · F4 cobrar · Esc limpar</span>
        {!blocked && (
          <>
            <button type="button" onClick={() => setHeldOpen(true)} className={BUTTON}>
              Em espera{others.length > 0 && ` (${others.length})`}
            </button>
            <button type="button" onClick={() => setSheet('history')} className={BUTTON}>
              Vendas
            </button>
          </>
        )}
        {settings.data?.pos.cash_control && (
          <button type="button" onClick={() => setSheet('cash')} className={BUTTON}>
            Caixa
          </button>
        )}
        <span className="hidden grid-cols-2 rounded-lg bg-seg p-[3px] sm:grid">
          {(['grid', 'search'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseLayout(value)}
              className={`h-[30px] rounded-md px-3 text-[13px] ${effectiveLayout === value ? 'bg-seg-on text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted'}`}
            >
              {value === 'grid' ? 'Grade' : 'Busca'}
            </button>
          ))}
        </span>
      </header>

      {blocked ? (
        <p className="m-4 rounded-lg border border-accent-line bg-accent-soft px-4 py-3 text-sm text-accent-fg">
          PDV indisponível: a loja está bloqueada.
        </p>
      ) : cashClosed ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 md:items-center">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-line bg-surface p-4">
            <p className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-fg">
              Caixa fechado: abra o caixa para vender.
            </p>
            <OpenCashForm />
          </div>
        </div>
      ) : (
        <>
          {menu.isError && <p className="px-4 py-2 text-sm text-accent-fg">Não foi possível carregar o cardápio.</p>}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <SearchBar
                inputRef={searchRef}
                query={query}
                onQuery={setQuery}
                products={products}
                big={effectiveLayout === 'search'}
                disabled={blocked}
                onSubmit={(text) => void submitSearch(text)}
                onPick={(product, qty) => {
                  addProduct(product, qty);
                  focusSearch();
                }}
              />
              {message && <p className="shrink-0 px-4 pb-2 text-sm text-accent-fg">{message}</p>}

              {effectiveLayout === 'search' && (
                <div className="hidden shrink-0 px-4 pb-3 md:block">
                  <button type="button" onClick={() => setShowProducts(!showProducts)} className={BUTTON}>
                    {showProducts ? 'Ver venda' : 'Ver produtos'}
                  </button>
                </div>
              )}

              <div
                className={`min-h-0 flex-1 flex-col ${effectiveLayout === 'grid' || showProducts ? 'flex' : 'flex md:hidden'}`}
              >
                <ProductGrid
                  categories={categories}
                  onPick={(product) => {
                    addProduct(product, 1);
                    focusSearch();
                  }}
                />
              </div>

              {effectiveLayout === 'search' && <div className={saleBox(true)}>{salePanel}</div>}

              {count > 0 && !saleOpen && (
                <button
                  type="button"
                  onClick={() => setSaleOpen(true)}
                  className="fixed inset-x-3 bottom-3 z-30 h-14 rounded-xl bg-accent text-base font-semibold text-white shadow-lg md:hidden"
                >
                  Ver venda ({count}) · {formatMoney(shown?.total_cents ?? 0)}
                </button>
              )}
            </div>

            {effectiveLayout === 'grid' && <div className={saleBox(false)}>{salePanel}</div>}
          </div>
        </>
      )}

      {picking && (
        <ProductDetails
          product={picking.product}
          preselected={picking.preselected}
          initialQty={picking.qty}
          allowSoldOut
          onClose={() => {
            setPicking(undefined);
            focusSearch();
          }}
          onAdd={(line) =>
            void addLine(picking.product, {
              product_id: line.product_id,
              qty: line.qty,
              selections: line.selections,
              notes: line.notes
            })
          }
        />
      )}

      {candidates && (
        <div
          role="presentation"
          onClick={() => setCandidates(undefined)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Qual produto?"
            onClick={(event) => event.stopPropagation()}
            className="flex w-full max-w-sm flex-col rounded-xl border border-line bg-surface text-fg"
          >
            <p className="border-b border-line px-4 py-3 text-sm font-semibold">Qual produto?</p>
            <ul>
              {candidates.list.map((candidate) => (
                <li key={`${candidate.product_id}:${candidate.selection?.option_id ?? ''}`}>
                  <button
                    type="button"
                    onClick={() => addCandidate(candidate, candidates.qty)}
                    className="w-full border-b border-line px-4 py-3 text-left text-sm hover:bg-hover"
                  >
                    {candidate.product_name}
                    {candidate.selection && <span className="text-muted"> · {candidate.selection.option_name}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {paying && (
        <PaymentStep
          sale={paying}
          methods={settings.data?.payment_methods ?? []}
          storeName={store.name}
          receiptWidth={settings.data?.pos.receipt_width ?? 80}
          onDetach={() => {
            if (current.current.id === paying.id) {
              setSaleId(undefined);
            }
          }}
          onBack={() => {
            setPaying(undefined);

            // Finalizing detached it; a failed finalize keeps the sale (if it went through anyway, the screen says so).
            if (!current.current.id) {
              setSaleId(paying.id);
            }
          }}
          onNew={() => {
            setPaying(undefined);
            setSaleId(undefined);
            focusSearch();
          }}
        />
      )}

      {sheet === 'cash' && (
        <CashPanel
          storeName={store.name}
          receiptWidth={settings.data?.pos.receipt_width ?? 80}
          onClose={() => setSheet(undefined)}
        />
      )}

      {sheet === 'history' && <SaleHistory onClose={() => setSheet(undefined)} />}

      {heldOpen && (
        <HeldSales
          sales={others}
          onClose={() => setHeldOpen(false)}
          onPick={(id) => {
            setHeldOpen(false);
            setSaleId(id);
          }}
        />
      )}
    </div>
  );
}
