import { useEffect } from 'react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/**
 * Four-digit PIN pad (also typed on a keyboard). The parent owns the value and submits when it has four digits.
 */
export function PinPad({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled) {
        return;
      }

      if (/^\d$/.test(event.key)) {
        onChange((value + event.key).slice(0, 4));
      } else if (event.key === 'Backspace') {
        onChange(value.slice(0, -1));
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [value, disabled, onChange]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-3" aria-label={`${value.length} de 4 dígitos`} role="img">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={`size-3.5 rounded-full ${index < value.length ? 'bg-fg' : 'bg-line-2'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {KEYS.map((key, index) =>
          key ? (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-label={key === '⌫' ? 'Apagar' : key}
              onClick={() => onChange(key === '⌫' ? value.slice(0, -1) : (value + key).slice(0, 4))}
              className="size-16 rounded-full border border-line bg-surface text-xl font-semibold hover:bg-hover disabled:opacity-50"
            >
              {key}
            </button>
          ) : (
            <span key={index} />
          )
        )}
      </div>
    </div>
  );
}
