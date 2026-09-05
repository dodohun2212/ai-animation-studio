/**
 * The prompt sections the server can drop to fit Runway's length limit, in the words the rest of the app uses.
 *
 * Lives here rather than in a screen because two screens need it now: the short project's prompt preview, which
 * has shown this since it shipped, and the Episode's, which was throwing the server's list away. Two copies of
 * one table is how the mapping status labels drifted — one said 확정됨 where the screen said 확인됨 — and the
 * unread copy is always the one that loses.
 *
 * An unknown label passes through rather than disappearing: a section this table cannot name is still a section
 * the person needs to know is missing, and paid for without.
 */
const OMITTED_SECTION_LABELS: Record<string, string> = {
  "Continuity cue": "장면 연결",
  Environment: "환경 움직임",
  Performance: "표정·연기",
  Pacing: "움직임 속도",
};

export function omittedSectionLabel(section: string): string {
  return OMITTED_SECTION_LABELS[section] ?? section;
}
