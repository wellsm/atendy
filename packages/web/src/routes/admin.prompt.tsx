import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { useAdminPrompt } from '../lib/queries';

export const Route = createFileRoute('/admin/prompt')({
  component: () => (
    <SignedIn>
      <PromptPage />
    </SignedIn>
  )
});

function PromptPage() {
  const prompt = useAdminPrompt();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-sm text-neutral-500">
            ← Lojas
          </Link>
          <h1 className="text-xl font-semibold">Prompt {prompt.data && `· versão ${prompt.data.version}`}</h1>
        </div>
        <UserButton />
      </header>

      {prompt.isPending && <Loading />}
      {prompt.isError && <p className="text-sm text-red-700">Não foi possível carregar o prompt.</p>}

      {prompt.data && (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-neutral-600">
            Somente leitura. A versão muda sozinha quando o código do prompt muda. As regras de cada loja (SOP) são
            acrescentadas ao prompt do sistema e não entram na versão.
          </p>
          <Block title="Prompt do sistema" text={prompt.data.system} />
          <Block title="Prompt da resposta (após ação do Jev)" text={prompt.data.reply} />
          <Block title="Ferramentas" text={prompt.data.tools} />
        </div>
      )}
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs">{text}</pre>
    </section>
  );
}
