// The "a" as a speech bubble: bowl, stem and the tail at the stem's foot (SVG masters and usage rules in docs/brand/).
const SYMBOL =
  'M112 40 H172 A28 28 0 0 1 200 68 V188 L228 216 H112 A88 88 0 0 1 112 40 Z M152 128 A40 42 0 1 0 72 128 A40 42 0 1 0 152 128 Z';

// "atendy" drawn as geometric paths (no font); pieces overlap on purpose, abutting edges show seams when scaled down.
const WORDMARK = [
  'M98 128 A49 49 0 1 0 0 128 A49 49 0 1 0 98 128 Z M74 128 A25 25 0 1 0 24 128 A25 25 0 1 0 74 128 Z',
  'M74 80 H98 V176 H74 Z',
  'M124 52 H148 V176 H124 Z',
  'M108 80 H170 V102 H108 Z',
  'M274.97 118 A49 49 0 1 0 261.65 162.65 L244.68 145.68 A25 25 0 1 1 249.91 118 Z',
  'M200 118 H275 V138 H200 Z',
  'M290 80 H314 V176 H290 Z',
  'M290 123 A45 45 0 0 1 380 123 H356 A21 21 0 0 0 314 123 Z',
  'M356 116 H380 V176 H356 Z',
  'M492 128 A49 49 0 1 0 394 128 A49 49 0 1 0 492 128 Z M468 128 A25 25 0 1 0 418 128 A25 25 0 1 0 468 128 Z',
  'M468 40 H492 V176 H468 Z',
  'M498 80 H524 L559 176 H533 Z',
  'M568 80 H594 L544.4 216 H518.4 Z'
];

/**
 * Horizontal logo, sized by height (`h-5`). The wordmark follows the text color; the symbol keeps the brand orange
 * unless `mono` (white logo on the orange panels).
 */
export function Logo({ className = '', mono = false }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="24 40 852 176" role="img" aria-label="Atendy" className={`w-auto fill-current ${className}`}>
      <path fillRule="evenodd" d={SYMBOL} className={mono ? undefined : 'fill-[#e35205]'} />
      <g transform="translate(282 0)" fillRule="evenodd">
        {WORDMARK.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
