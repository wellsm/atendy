import type { ReactNode } from 'react';

import { ClerkProvider } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';

import { ApiError } from '../lib/api';
import appCss from '../styles.css?url';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx answers (no access, not found) do not get better on retry.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2
    }
  }
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Atendy' }
    ],
    links: [{ rel: 'stylesheet', href: appCss }]
  }),
  shellComponent: RootDocument,
  component: RootComponent
});

function RootComponent() {
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
    >
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
