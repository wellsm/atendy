import type { ChangeEvent, ClipboardEvent } from 'react';

import { useState } from 'react';

import { ApiError } from '../lib/api';
import { PROSPECTING_AI_PROMPT, PROSPECTING_EXAMPLE } from '../lib/prospecting';
import { useImportProspects } from '../lib/queries';

const ERRORS_SHOWN = 20;

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none';

/**
 * Text above this size never goes into the textarea: a controlled textarea with megabytes of JSON freezes the page.
 */
const LARGE_TEXT = 200_000;

type LoadedFile = { name: string; size: number; body: unknown; leads: number | null };

const loadJson = (name: string, text: string): LoadedFile | string => {
  try {
    const body: unknown = JSON.parse(text);
    const leads = (body as { leads?: unknown } | null)?.leads;

    return { name, size: text.length, body, leads: Array.isArray(leads) ? leads.length : null };
  } catch {
    return 'O texto não é um JSON válido.';
  }
};

const formatSize = (size: number) =>
  size >= 1_000_000 ? `${(size / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(size / 1_000)} KB`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
    >
      {copied ? 'Copiado' : label}
    </button>
  );
}

export function ProspectingImport() {
  const importLeads = useImportProspects();

  const [source, setSource] = useState('');
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [part, setPart] = useState<[number, number] | null>(null);

  const load = (name: string, text: string) => {
    const result = loadJson(name, text);

    setParseError(typeof result === 'string' ? result : null);
    setLoaded(typeof result === 'string' ? null : result);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      load(file.name, await file.text());
    }

    event.target.value = '';
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');

    if (text.length > LARGE_TEXT) {
      event.preventDefault();
      load('Texto colado', text);
    }
  };

  const onImport = () => {
    setParseError(null);
    setPart(null);

    const onPart = (current: number, parts: number) => setPart([current, parts]);

    if (loaded) {
      importLeads.mutate({ body: loaded.body, onPart });
      return;
    }

    try {
      importLeads.mutate({ body: JSON.parse(source), onPart });
    } catch {
      setParseError('O texto não é um JSON válido.');
    }
  };

  const result = importLeads.data;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-col gap-2 text-sm text-neutral-700">
        <p>
          Cole ou envie um arquivo <code>.json</code> com <code>{'{ "leads": [...] }'}</code>. Cada lead tem{' '}
          <code>name</code>, <code>phone</code> (com DDD), <code>messages</code> (2 a 4 variações, até 500 caracteres,
          sem links) e, se quiser, <code>info</code> (só textos e números) e os campos opcionais do exemplo (categoria,
          bairro, zona, cidade, situação, sistemas, avaliação, encaixe de 0 a 10, site e celular). Os leads importados
          ficam como Disponível até você enviá-los pela lista. Arquivos com mais de 2.000 leads são enviados em partes
          de 2.000, uma de cada vez. Telefones repetidos (com ou sem o 9) são ignorados. Cada lead recebe uma das
          variações, sorteada.
        </p>
        <pre className="overflow-x-auto rounded-md bg-neutral-50 p-3 text-xs">{PROSPECTING_EXAMPLE}</pre>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={PROSPECTING_EXAMPLE} label="Copiar formato" />
          <CopyButton text={PROSPECTING_AI_PROMPT} label="Copiar prompt pra IA" />
        </div>
      </div>

      {loaded ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-neutral-50 p-3 text-sm">
          <span>
            {loaded.name} · {formatSize(loaded.size)}
            {loaded.leads !== null && ` · ${loaded.leads.toLocaleString('pt-BR')} leads`}
          </span>
          <button
            type="button"
            disabled={importLeads.isPending}
            onClick={() => setLoaded(null)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50"
          >
            Remover
          </button>
        </div>
      ) : (
        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          onPaste={onPaste}
          spellCheck={false}
          rows={8}
          placeholder='{ "leads": [ ... ] }'
          className={`${INPUT} font-mono text-xs`}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => void onFile(event)}
          className="text-sm"
        />
        <button
          type="button"
          disabled={(!loaded && !source.trim()) || importLeads.isPending}
          onClick={onImport}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {importLeads.isPending ? (part ? `Importando parte ${part[0]} de ${part[1]}…` : 'Importando…') : 'Importar'}
        </button>
        {parseError && <span className="text-sm text-red-700">{parseError}</span>}
        {importLeads.isError && (
          <span className="text-sm text-red-700">
            {importLeads.error instanceof ApiError && importLeads.error.status === 400
              ? (importLeads.error.detail ?? 'Arquivo inválido.')
              : 'Não foi possível importar.'}
            {part &&
              part[0] > 1 &&
              ` Parte ${part[0]} de ${part[1]}: as anteriores já foram importadas; importar de novo ignora os repetidos.`}
          </span>
        )}
      </div>

      {result && (
        <div className="flex flex-col gap-2 rounded-md bg-neutral-50 p-3 text-sm">
          <p>
            {result.added} adicionados · {result.skipped_duplicate} duplicados · {result.skipped_invalid} inválidos (de{' '}
            {result.total}).
          </p>
          {result.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-red-800">
              {result.errors.slice(0, ERRORS_SHOWN).map((error) => (
                <li key={`${error.row}-${error.reason}`}>
                  Linha {error.row}: {error.reason}
                </li>
              ))}
              {result.errors.length > ERRORS_SHOWN && <li>… e mais {result.errors.length - ERRORS_SHOWN}.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
