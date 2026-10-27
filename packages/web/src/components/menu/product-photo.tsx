import type { ChangeEvent } from 'react';

import { useState } from 'react';

import { resizeImage } from '../../lib/image';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Optional product photo: square box on desktop, wide banner on phones. Picking a file resizes it right away; the
 * form uploads it after the product is saved.
 */
export function ProductPhoto(props: { url: string | null; onPick: (blob: Blob) => void; onRemove: () => void }) {
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

  const input = <input type="file" accept={ACCEPT} onChange={(event) => void pick(event)} className="sr-only" />;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">
        Foto <span className="font-normal text-faint">(opcional)</span>
      </span>

      {props.url ? (
        <>
          <img src={props.url} alt="" className="h-48 w-full rounded-xl bg-surface-2 object-cover md:size-50 md:h-50" />
          <div className="flex gap-3 text-[13px]">
            <label className="cursor-pointer font-medium text-accent-fg hover:underline">
              {reading ? 'Lendo…' : 'Trocar'}
              {input}
            </label>
            <button type="button" onClick={props.onRemove} className="text-muted hover:text-fg">
              Remover
            </button>
          </div>
        </>
      ) : (
        <label className="flex h-32 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-line-2 bg-hover p-4 text-center hover:border-red-400 hover:bg-accent-soft md:size-50 md:h-50">
          <span className="text-[22px] text-faint">+</span>
          <span className="text-[13px] font-medium text-fg-2">{reading ? 'Lendo a foto…' : 'Enviar foto'}</span>
          <span className="text-xs leading-snug text-muted">JPG, PNG ou WebP. Aparece no cardápio público.</span>
          {input}
        </label>
      )}

      {failed && <span className="text-xs text-accent-fg">Não foi possível ler esta imagem. Tente outra foto.</span>}
    </div>
  );
}
