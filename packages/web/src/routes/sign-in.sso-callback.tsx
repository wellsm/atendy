import { HandleSSOCallback } from '@clerk/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { goTo } from '../lib/auth';

export const Route = createFileRoute('/sign-in/sso-callback')({
  component: SsoCallback
});

/**
 * Back from Google: Clerk finishes the sign-in (or the sign-up of a new user) and we go to the panel. When Clerk needs
 * more information it sends the user back to the sign-in screen.
 */
function SsoCallback() {
  const navigate = useNavigate();
  const toSignIn = () => void navigate({ to: '/sign-in' });

  return (
    <>
      <Loading />
      <HandleSSOCallback
        navigateToApp={({ decorateUrl }) => goTo(decorateUrl('/'), (path) => void navigate({ to: path }))}
        navigateToSignIn={toSignIn}
        navigateToSignUp={toSignIn}
      />
    </>
  );
}
