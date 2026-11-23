import type { AdminPrompt } from '../lib/queries';
import type { StoreType } from '../lib/store-type';

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

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

type Block = 'system' | 'reply' | 'redirect' | 'tools';

const BLOCKS: [Block, string][] = [
  ['system', 'Prompt do sistema'],
  ['reply', 'Resposta após ação do Jev'],
  ['redirect', 'Loja de direcionamento'],
  ['tools', 'Ferramentas']
];

const VOICES: [StoreType, string][] = [
  ['food', 'Cardápio'],
  ['retail', 'Catálogo']
];

const blockText = (prompt: AdminPrompt, voice: StoreType, block: Block) => {
  switch (block) {
    case 'system':
      return voice === 'retail' ? prompt.retail.system : prompt.system;
    case 'reply':
      return voice === 'retail' ? prompt.retail.reply : prompt.reply;
    case 'redirect':
      return prompt.redirect[voice];
    case 'tools':
      return prompt.tools;
  }
};

const lineCount = (text: string) => text.split('\n').length;

function PromptPage() {
  const prompt = useAdminPrompt();
  const [voice, setVoice] = useState<StoreType>('food');
  const [block, setBlock] = useState<Block>('system');
  const [copied, setCopied] = useState(false);
  const { data } = prompt;
  const text = data ? blockText(data, voice, block) : '';

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">
          Prompt {data && <span className="font-mono text-sm font-normal text-muted">{data.version}</span>}
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Somente leitura. A versão muda sozinha quando o código do prompt muda (cardápio e catálogo). As regras de cada
          loja (SOP) são acrescentadas ao prompt do sistema e não entram na versão.
        </p>
      </header>

      {prompt.isPending && <Loading />}
      {prompt.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o prompt.</p>}

      {data && (
        <>
          <div className="mb-3 inline-flex rounded-lg bg-surface-2 p-0.5 text-[13px] font-medium">
            {VOICES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={voice === id}
                onClick={() => setVoice(id)}
                className={`rounded-md px-3 py-1 ${voice === id ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-5 overflow-x-auto border-b border-line">
            {BLOCKS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={block === id}
                onClick={() => setBlock(id)}
                className={`-mb-px shrink-0 border-b-2 pb-2.5 text-sm whitespace-nowrap ${
                  block === id
                    ? 'border-accent font-semibold text-fg'
                    : 'border-transparent font-medium text-muted hover:text-fg'
                }`}
              >
                {label}{' '}
                <span className="text-xs font-normal text-faint">{lineCount(blockText(data, voice, id))} linhas</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => void copy()}
              className="mb-1.5 ml-auto shrink-0 rounded-md border border-line-2 bg-surface px-3 py-1 text-[13px] font-medium hover:bg-hover"
            >
              {copied ? 'Copiado ✓' : 'Copiar'}
            </button>
          </div>

          <pre className="mt-4 max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface p-5 text-xs break-words whitespace-pre-wrap">
            {text}
          </pre>
        </>
      )}
    </div>
  );
}
