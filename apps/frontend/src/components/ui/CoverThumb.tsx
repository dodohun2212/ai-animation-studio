import { useState } from "react";

interface Props {
  /** The picture to show. Undefined, or one that fails to load, falls back to the brand glyph. */
  src?: string;
  alt?: string;
  /** Tailwind size classes for the box — the caller decides how big a thumbnail is on its screen. */
  className?: string;
}

/**
 * The brand glyph, drawn when there is no picture yet.
 *
 * Lifted out of ProjectList, where it was the only thing a project row could show. It stays because a project
 * that has not reached image generation genuinely has no picture — and an empty grey square reads as a broken
 * image rather than as "nothing here yet" (design system §3.6: an empty state says what is missing).
 */
function BrandGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-1/2 w-1/2">
      <defs>
        <linearGradient id="coverThumbGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#f0abfc" />
        </linearGradient>
      </defs>
      <path
        d="M24 4 L42 14 L42 34 L24 44 L6 34 L6 14 Z M24 4 L24 24 L42 14 M24 24 L6 14 M24 24 L24 44"
        fill="none"
        stroke="url(#coverThumbGradient)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A card's picture, with the fallback built in.
 *
 * 🔴 The fallback is the whole reason this exists rather than a bare `<img>`. A project's cover is its first
 * scene image, and that file is absent for every project before image generation and for every project whose
 * generation failed — so the common case is "no picture", not the exception. Handled at the call site it was
 * handled once (ProjectList drew the glyph and never tried a real picture at all); handled here every screen
 * gets both halves.
 *
 * `onError` rather than a HEAD request: the route answers 404 for a missing scene image, and asking twice for
 * every card on a list screen to find that out is a request per card that tells the user nothing.
 */
export function CoverThumb({ src, alt = "", className = "h-16 w-16" }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== undefined && !failed;
  return (
    <span className={`relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-slate-800 ${className}`}>
      {showImage ? (
        <>
          <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
          {/* A thin inner shade so a bright picture does not fight the card's own border. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-slate-950/40 to-transparent" />
        </>
      ) : (
        <BrandGlyph />
      )}
    </span>
  );
}
