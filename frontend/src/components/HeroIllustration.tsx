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
      {/* Parchment body - kept as the dominant fill so the shape reads
          as a real sheet of paper rather than mostly the darker rolled
          ends around it. */}
      <rect x="15" y="10" width="70" height="120" rx="4" fill="#fae8ff" />

      {/* Rolled top/bottom ends - the darker "cap" tone, same trick as
          the castle's roof triangles and schrank's cornice. */}
      <rect x="13" y="8" width="74" height="14" rx="7" fill="#c026d3" />
      <rect x="13" y="118" width="74" height="14" rx="7" fill="#c026d3" />

      {/* A few lines of "writing" on the letter. */}
      <rect x="27" y="38" width="46" height="4" rx="2" fill="#e9aef0" />
      <rect x="27" y="50" width="36" height="4" rx="2" fill="#e9aef0" />
      <rect x="27" y="62" width="42" height="4" rx="2" fill="#e9aef0" />

      {/* Wax seal, closing the letter - plays a brief "stamping down"
          settle on mount (see index.css's herold-seal-stamp), the same
          scale-from-center technique as schrank's door-seam-close. */}
      <circle className="herold-seal-stamp" cx="50" cy="93" r="15" fill="#a21caf" />
      <circle cx="50" cy="93" r="6" fill="#fae8ff" />

      {/* Small signature accent mark, borrowed from schrank's own
          accent rather than Herold's - a drip of sealing wax. */}
      <circle cx="68" cy="28" r="3" fill="#92400e" />
    </svg>
  )
}
