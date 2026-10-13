import { SignIn } from '@clerk/react';
import { createFileRoute } from '@tanstack/react-router';

// Sign-in-or-up: an unknown email continues into sign-up on this same page (no separate /sign-up).
export const Route = createFileRoute('/sign-in/$')({
  component: () => (
    <div className="flex min-h-screen items-center justify-center p-4">
      <SignIn routing="path" path="/sign-in" withSignUp forceRedirectUrl="/" signUpForceRedirectUrl="/" />
    </div>
  )
});
