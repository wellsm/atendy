import type { ReactNode } from 'react';

import { UserButton, useUser } from '@clerk/react';
import { Link, useRouterState } from '@tanstack/react-router';

import { Logo } from './logo';
import { addDays, todayInSaoPaulo } from '../lib/costs';
import { formatMoney } from '../lib/format';
import { useAdminStores, useCostReport } from '../lib/queries';
import { usePanelTheme } from '../lib/theme';

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

/**
 * `section` is the path segment after `/admin`; '' is the stores list (and any store page).
 */
const NAV = [
  { to: '/admin', section: '', label: 'Lojas' },
  { to: '/admin/conversations', section: 'conversations', label: 'Conversas' },
  { to: '/admin/costs', section: 'costs', label: 'Custos' },
  { to: '/admin/simulations', section: 'simulations', label: 'Simulações' },
  { to: '/admin/prospecting', section: 'prospecting', label: 'Prospecção' },
  { to: '/admin/prompt', section: 'prompt', label: 'Prompt' },
  { to: '/admin/users', section: 'users', label: 'Usuários' }
] as const;

const sectionOf = (pathname: string) => {
  const segment = pathname.split('/')[2] ?? '';

  return NAV.some(({ section }) => section === segment) ? segment : '';
};

/**
 * Admin frame: sidebar on desktop, a scrolling nav bar on top on phones.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = sectionOf(pathname);
  const { theme, setTheme } = usePanelTheme();
  const stores = useAdminStores();
  const all = stores.data?.stores ?? [];
  const badges: Record<string, { count: number; className: string }> = {
    '': { count: all.filter(({ active }) => !active).length, className: 'bg-accepted-bg text-warn-fg' },
    conversations: {
      count: all.reduce((sum, { error_count24h }) => sum + error_count24h, 0),
      className: 'bg-danger-soft text-danger-fg'
    }
  };

  const themeButton = (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="shrink-0 rounded-md border border-line-2 px-2 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2"
    >
      {theme === 'dark' ? 'Claro' : 'Escuro'}
    </button>
  );

  return (
    <div className="min-h-screen bg-page text-fg md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-58 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 md:px-5 md:pt-5 md:pb-4">
          <Logo className="h-4 text-accent" />
          <span className="rounded-[5px] bg-fg px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-surface uppercase">
            Admin
          </span>
          <span className="ml-auto flex items-center gap-2 md:hidden">
            {themeButton}
            <UserButton />
          </span>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:gap-0.5 md:overflow-visible md:px-2.5">
          {NAV.map(({ to, section, label }) => {
            const active = section === current;
            const badge = badges[section];

            return (
              <Link
                key={section}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={`flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm whitespace-nowrap md:h-9.5 ${
                  active ? 'bg-accent-soft font-semibold text-accent-fg' : 'font-medium text-fg-2 hover:bg-surface-2'
                }`}
              >
                <span className="md:flex-1">{label}</span>
                {!!badge?.count && (
                  <span className={`rounded-full px-1.75 py-px text-[11px] font-semibold ${badge.className}`}>
                    {badge.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <LastMonth />

        <div className="hidden items-center gap-2.5 border-t border-line px-4 py-3 md:flex">
          <UserButton />
          <UserEmail />
          {themeButton}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

/**
 * Billed and AI cost of the last 30 days; same range as the costs page default, so both share the query.
 */
function LastMonth() {
  const today = todayInSaoPaulo();
  const report = useCostReport({ from: addDays(today, -29), to: today });

  if (!report.data) {
    return null;
  }

  return (
    <div className="mx-2.5 mb-3 hidden flex-col gap-1.5 rounded-lg bg-hover px-3 py-2.5 text-xs md:flex">
      <span className="font-medium text-muted">Últimos 30 dias</span>
      <span className="flex justify-between">
        <span className="text-muted">Cobrado</span>
        <b className="font-semibold">{formatMoney(report.data.billing.amount_cents)}</b>
      </span>
      <span className="flex justify-between">
        <span className="text-muted">IA</span>
        <b className="font-semibold">{usd.format(report.data.ai.total_usd)}</b>
      </span>
    </div>
  );
}

function UserEmail() {
  const { user } = useUser();

  return (
    <span className="min-w-0 flex-1 truncate text-xs text-fg-2">{user?.primaryEmailAddress?.emailAddress ?? ''}</span>
  );
}
