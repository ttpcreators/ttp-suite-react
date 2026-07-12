/** Filtre SVG « gooey » (effet liquide/metaball) — à référencer via filter:url(#id). */
export function GooeyFilter({ id = "goo-filter", strength = 10 }: { id?: string; strength?: number }) {
  return (
    <svg aria-hidden className="absolute hidden">
      <defs>
        <filter id={id}>
          <feGaussianBlur in="SourceGraphic" stdDeviation={strength} result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
}
