import type { ReactNode } from 'react';

/**
 * Small on/off switch.
 */
export function Toggle(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className="shrink-0 disabled:opacity-60"
    >
      <span className={`relative block h-5 w-9 rounded-full transition-colors ${props.checked ? 'bg-on' : 'bg-off'}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${props.checked ? 'left-4.5' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}

/**
 * An on/off setting: a card with the switch in front of its title and optional explanation.
 */
export function SwitchCard(props: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description?: ReactNode;
  className?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border-[1.5px] border-line-2 bg-surface p-3 text-sm ${props.className ?? ''}`}
    >
      <Toggle checked={props.checked} disabled={props.disabled} label={props.title} onChange={props.onChange} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{props.title}</span>
        {props.description && <span className="text-xs text-muted">{props.description}</span>}
      </span>
    </label>
  );
}
