import type { ReactNode } from 'react';

import { RedirectToSignIn, useAuth } from '@clerk/react';

import { Loading } from './loading';

/**
 * Renders children only for a signed-in user; otherwise sends them to the sign-in page.
 */
export function SignedIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <Loading />;
  }

  if (!isSignedIn) {
    return <RedirectToSignIn />;
  }

  return children;
}
