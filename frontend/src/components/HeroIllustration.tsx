// A flat-vector paper airplane - the herald's message, dispatched - in
// the same construction style as schrank's own wardrobe illustration
// (flat filled shapes, no strokes, one darker "fold" tone splitting the
// dart in two for dimensionality, one small signature accent mark in
// schloss's own violet, same as every sibling illustration's own
// cross-service wink). Unlike the two earlier attempts at a scroll+seal
// and a herald's horn (both of which needed several small shapes to
// cohere into one recognizable object and didn't - the horn in
// particular kept reading as a funnel/traffic-cone instead), a paper
// airplane's silhouette is instantly and unambiguously readable on its
// own, at any size, and doesn't collide with kuvert's own envelope.
export function HeroIllustration({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size * (100 / 140)}
      height={size}
      viewBox="0 0 100 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Herold"
      className={className}
    >
      {/* Plays a brief "just arrived" swoop-and-settle on mount (see
          index.css's herold-plane-fly-in). */}
      <g className="herold-plane-fly-in">
        {/* Dart body - the left (light) half. */}
        <path d="M 55 18 L 92 118 L 55 92 L 18 118 Z" fill="#c026d3" />
        {/* Fold crease - the right half laid over in the darker tone,
            reading as the paper's far wing catching less light, same
            "cap over body" logic as the castle's darker roof triangles. */}
        <path d="M 55 18 L 92 118 L 55 92 Z" fill="#a21caf" />

        {/* Signature accent - schloss's own violet, a small
            cross-service wink tying the illustration family together
            (same color kuvert/tafel/zettel/schrank use for theirs). */}
        <circle cx="63" cy="78" r="4" fill="#863bff" />

        {/* Motion trail, trailing off the tail. */}
        <rect x="10" y="128" width="18" height="5" rx="2.5" fill="#ffffff" transform="rotate(-18 10 128)" />
        <rect x="6" y="112" width="12" height="5" rx="2.5" fill="#ffffff" transform="rotate(-18 6 112)" />
      </g>
    </svg>
  )
}
