// A flat-vector herald's letter - a rolled scroll of parchment closed
// with a wax seal - in the same construction style as schrank's own
// wardrobe illustration (flat filled shapes, no strokes, one light
// recess tone, one small signature accent mark borrowed from a sibling
// app's color rather than this app's own accent). Part of the same
// visual family, different subject and color.
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
      {/* Parchment body - a flat sheet, capped top and bottom by rolled
          ends (below) so the silhouette reads as an actual rolled scroll
          rather than a flat card. */}
      <rect x="15" y="20" width="70" height="100" fill="#fae8ff" />

      {/* Rolled ends - ellipses straddling the body's top/bottom edges,
          the darker "cap" tone, same trick as the castle's roof
          triangles and schrank's cornice. */}
      <ellipse cx="50" cy="20" rx="35" ry="9" fill="#c026d3" />
      <ellipse cx="50" cy="120" rx="35" ry="9" fill="#c026d3" />
      {/* Recessed centers of each roll, reading as the hollow tube ends. */}
      <ellipse cx="50" cy="19" rx="19" ry="4.5" fill="#a21caf" />
      <ellipse cx="50" cy="121" rx="19" ry="4.5" fill="#a21caf" />

      {/* A couple of lines of "writing", peeking out above the seal. */}
      <rect x="30" y="38" width="40" height="4" rx="2" fill="#e9aef0" />
      <rect x="30" y="48" width="28" height="4" rx="2" fill="#e9aef0" />

      {/* Wax seal, closing the letter over its midpoint - plays a brief
          "stamping down" settle on mount (see index.css's
          herold-seal-stamp), the same scale-from-center technique as
          schrank's door-seam-close. */}
      <circle className="herold-seal-stamp" cx="50" cy="85" r="19" fill="#a21caf" />
      <circle cx="50" cy="85" r="8" fill="#fae8ff" />

      {/* A drip of sealing wax - the small signature accent mark
          borrowed from schrank's own accent rather than Herold's. */}
      <circle cx="67" cy="99" r="3" fill="#92400e" />
    </svg>
  )
}
