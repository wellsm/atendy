import type { ReactNode } from 'react';
import type { PosSale } from '../../lib/queries';

import { createPortal } from 'react-dom';

import { formatMoney, formatWhen, orderCustomerName, PAYMENT_LABEL } from '../../lib/format';

/**
 * Print-only markup for a thermal roll (`window.print()`): mounted on `body`, next to the POS screen, which hides
 * itself in print. Mount one at a time, only while its content is the thing to print.
 */
export function PrintSheet({ width, children }: { width: 58 | 80; children: ReactNode }) {
  return createPortal(
    <div
      className={`hidden bg-white p-[3mm] font-mono text-[11px] leading-tight text-black print:block ${width === 58 ? 'w-[58mm]' : 'w-[80mm]'}`}
    >
      {/* The roll width is a store setting, so the page size cannot be a static rule in styles.css. */}
      <style>{`@page { size: ${width}mm auto; margin: 0; }`}</style>
      {children}
      <p className="mt-2 text-center">Não é documento fiscal</p>
    </div>,
    document.body
  );
}

/**
 * A label and a value on one line of the roll.
 */
export function PrintRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-2 ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="shrink-0">{value}</span>
    </p>
  );
}

export function SaleReceipt({ storeName, sale }: { storeName: string; sale: PosSale }) {
  return (
    <>
      <p className="text-center font-bold">{storeName}</p>
      <p className="text-center">
        #{sale.code} · {formatWhen(sale.placed_at)}
      </p>
      {sale.customer && <p className="text-center">{orderCustomerName({ customer: sale.customer })}</p>}

      <div className="my-1.5 border-t border-dashed border-black" />
      {sale.items.map((item) => (
        <div key={item.item_id}>
          <PrintRow label={`${item.qty}× ${item.name}`} value={formatMoney(item.line_total_cents)} />
          {item.options && <p className="pl-3">{item.options}</p>}
          {item.notes && <p className="pl-3">Obs: {item.notes}</p>}
        </div>
      ))}

      <div className="my-1.5 border-t border-dashed border-black" />
      <PrintRow label="Subtotal" value={formatMoney(sale.subtotal_cents)} />
      {sale.discount_cents > 0 && <PrintRow label="Desconto" value={`− ${formatMoney(sale.discount_cents)}`} />}
      {sale.surcharge_cents > 0 && <PrintRow label="Acréscimo" value={`+ ${formatMoney(sale.surcharge_cents)}`} />}
      <PrintRow label="Total" value={formatMoney(sale.total_cents)} strong />

      <div className="my-1.5 border-t border-dashed border-black" />
      {sale.payments.map((payment) => (
        <div key={payment.id}>
          <PrintRow label={PAYMENT_LABEL[payment.method] ?? payment.method} value={formatMoney(payment.amount_cents)} />
          {payment.received_cents !== null && (
            <>
              <PrintRow label="  Recebido" value={formatMoney(payment.received_cents)} />
              <PrintRow label="  Troco" value={formatMoney(payment.change_cents ?? 0)} />
            </>
          )}
        </div>
      ))}
    </>
  );
}
