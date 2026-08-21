// A flat-vector sealed letter - a sheet of parchment bound with a ribbon
// and closed with a wax seal - in the same construction style as
// schrank's own wardrobe illustration (flat filled shapes, no strokes,
// one light recess tone, one small signature accent mark borrowed from a
// sibling app's color rather than this app's own accent). Deliberately
// simple: a rounded rectangle, one horizontal ribbon band, one large
// seal - three shapes, not competing with fine detail (rolled ends,
// lines of "writing") that read as noise rather than an object at the
// sizes this actually gets rendered at (a 16-24px sidebar/favicon glyph
// included).
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
      {/* Parchment body. */}
      <rect x="15" y="15" width="70" height="110" rx="8" fill="#fae8ff" />

      {/* Ribbon, wrapped around the letter - the darker "cap" tone, same
          trick as the castle's roof triangles and schrank's cornice. */}
      <rect x="15" y="60" width="70" height="16" fill="#c026d3" />

      {/* Wax seal, stamped over the ribbon - plays a brief "stamping
          down" settle on mount (see index.css's herold-seal-stamp), the
          same scale-from-center technique as schrank's door-seam-close. */}
      <circle className="herold-seal-stamp" cx="50" cy="68" r="23" fill="#a21caf" />
      <circle cx="50" cy="68" r="10" fill="#fae8ff" />

      {/* A drip of sealing wax - the small signature accent mark
          borrowed from schrank's own accent rather than Herold's. */}
      <circle cx="70" cy="86" r="4" fill="#92400e" />
    </svg>
  )
}
