/**
 * Small on/off switch for menu items.
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
      <span
        className={`relative block h-5 w-9 rounded-full transition-colors ${props.checked ? 'bg-green-600' : 'bg-neutral-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${props.checked ? 'left-4.5' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
