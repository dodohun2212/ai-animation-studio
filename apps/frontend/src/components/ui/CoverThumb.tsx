import { useState } from "react";

interface Props {
  /** The picture to show. Undefined, or one that fails to load, falls back to the brand glyph. */
  src?: string;
  alt?: string;
  /** Tailwind size classes for the box — the caller decides how big a thumbnail is on its screen. */
  className?: string;
  /**
   * 테두리와 모서리를 이 컴포넌트가 그리지 않게 한다 — 이미 테두리를 가진 틀 **안에** 놓을 때만.
   *
   * 🔴 `className` 으로 `rounded-none border-0` 을 덮어쓰지 않고 따로 받는 이유: Tailwind 의 충돌 해소는
   * 문자열에 쓴 순서가 아니라 **생성된 CSS 의 순서**를 따릅니다. `rounded-xl rounded-none` 은 어느 쪽이
   * 이길지 호출하는 쪽에서 알 수 없고, 빌드가 바뀌면 조용히 반대로 뒤집힙니다.
   */
  bare?: boolean;
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
          <stop offset="0%" stopColor="#cba878" />
          <stop offset="100%" stopColor="#e8e2d6" />
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
export function CoverThumb({ src, alt = "", className = "h-16 w-16", bare = false }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== undefined && !failed;
  const frame = bare ? "" : "rounded-xl border border-white/10";
  return (
    <span className={`relative flex flex-shrink-0 items-center justify-center overflow-hidden bg-ground-edge ${frame} ${className}`}>
      {showImage ? (
        <>
          <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
          {/* A thin inner shade so a bright picture does not fight the card's own border. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" />
        </>
      ) : (
        <BrandGlyph />
      )}
    </span>
  );
}
