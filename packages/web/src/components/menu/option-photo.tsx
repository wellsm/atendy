import type { ChangeEvent } from 'react';

import { useState } from 'react';

import { resizeImage } from '../../lib/image';

/**
 * Small photo slot in an option row: tap to pick (resized right away), ✕ to remove.
 */
export function OptionPhoto(props: {
  url: string | null;
  name: string;
  onPick: (blob: Blob) => void;
  onRemove: () => void;
}) {
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    event.target.value = '';

    if (!file) {
      return;
    }

    setReading(true);
    setFailed(false);

    try {
      props.onPick(await resizeImage(file));
    } catch {
      setFailed(true);
    } finally {
      setReading(false);
    }
  };

  return (
    <span className="relative size-10 shrink-0">
      <label
        title={failed ? 'Não foi possível ler esta imagem' : props.url ? 'Trocar foto' : 'Adicionar foto'}
        className={`flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-lg text-xs ${
          props.url
            ? 'bg-surface-2'
            : `border border-dashed ${failed ? 'border-red-400 text-danger-fg' : 'border-line-2 text-faint'} bg-hover hover:border-accent`
        }`}
      >
        {props.url ? (
          <img src={props.url} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden="true">{reading ? '…' : failed ? '!' : '+'}</span>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={`Foto de ${props.name || 'opção'}`}
          onChange={(event) => void pick(event)}
          className="sr-only"
        />
      </label>
      {props.url && (
        <button
          type="button"
          onClick={props.onRemove}
          aria-label={`Remover foto de ${props.name || 'opção'}`}
          className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white"
        >
          ✕
        </button>
      )}
    </span>
  );
}
