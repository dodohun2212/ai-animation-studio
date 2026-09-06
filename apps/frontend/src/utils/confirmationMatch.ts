/**
 * Confirmation boxes ask the reader to retype what the screen shows. What the screen shows is not always
 * what is stored: HTML collapses every run of whitespace, so a topic saved as `빨간 장미\n열렬한 사랑`
 * reaches the eye as `빨간 장미 열렬한 사랑` — and a one-line `<input>` cannot hold a newline at all. An
 * exact `===` against the stored string then demands a character the reader was never shown and the box is
 * incapable of containing, and the button stays disabled however carefully they type. 캡틴D hit exactly
 * that on `꽃말_장미` and retyped the topic several times believing the mistake was theirs.
 *
 * So compare on what was actually displayed, and let the caller send the stored value to the server. The
 * confirmation still requires the whole identifier to be retyped by hand — it only stops asking for
 * characters that never reached the screen.
 */
export function collapseForDisplay(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * True when `typed` is what the reader saw rendered for `expected`.
 *
 * An `expected` that collapses to nothing can never be confirmed: typing nothing proves no intent, and
 * these boxes stand in front of archiving and permanent deletion.
 */
export function confirmationMatches(typed: string, expected: string): boolean {
  const wanted = collapseForDisplay(expected);
  return wanted.length > 0 && collapseForDisplay(typed) === wanted;
}
