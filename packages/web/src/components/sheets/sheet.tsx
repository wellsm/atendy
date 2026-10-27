import type { ReactNode } from 'react';

import { useEffect } from 'react';

const WIDTH = {
  sm: 'md:w-[520px]',
  md: 'md:w-[680px]',
  lg: 'md:w-[880px]'
} as const;

/**
 * Right-side drawer over the panel. Overlay click and Esc close it; phones get the full width.
 */
export function Sheet({
  width,
  label,
  onClose,
  children
}: {
  width: keyof typeof WIDTH;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-overlay"
      />
      <section
        role="dialog"
        aria-modal
        aria-label={label}
        className={`absolute inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-line bg-surface text-fg shadow-[-24px_0_60px_-24px_rgba(0,0,0,0.45)] ${WIDTH[width]}`}
      >
        {children}
      </section>
    </div>
  );
}

/**
 * Sheet title row: optional back arrow, title and subtitle, extra actions, close button.
 */
export function SheetHeader({
  title,
  subtitle,
  onBack,
  onClose,
  children
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-4 md:px-6">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Voltar" className="pr-1 text-lg text-fg-2">
          ←
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="truncate text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="size-9 shrink-0 rounded-full bg-surface-2 text-fg-2 hover:bg-line"
      >
        ✕
      </button>
    </header>
  );
}
