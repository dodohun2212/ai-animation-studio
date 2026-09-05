/**
 * What a 명언(포토) 카드 is made of, in one place, because two parts of the app were answering it separately.
 *
 * A card is a picture already chosen with a line of text laid over it. It has two steps — decide the subtitle
 * layout and music and merge, then publish — and it never has the story steps: 대본, 참고 이미지 연결, 장면
 * 이미지, 영상 만들기.
 *
 * 🔴 The router already replaces those screens with an explanation. The project detail screen did not know,
 * and kept offering 장면 편집 and 내레이션 확인 for a card — buttons whose only destination was that
 * explanation. A screen that offers a door and a screen that says the door is not there are the same defect we
 * keep finding, one file apart, so the list lives here and both read it.
 *
 * Names are plain strings here on purpose: `Screen` is declared in App.tsx, which imports this module, and a
 * type import back would be a cycle. App.tsx assigns these into a `Set<Screen["name"]>`, which is where the
 * compiler checks that every name below is a real screen — a renamed screen breaks that line rather than
 * silently emptying the gate.
 */
export const PHOTO_CARD_STEPS = [
  { name: "videoMerge", label: "자막·음악 정하고 영상 만들기" },
  { name: "instagramPost", label: "게시물 준비" },
] as const;

/** The story-only screens. Reachable by an old link or Back, so they explain themselves rather than 404-ing. */
export const PHOTO_CARD_SKIPPED_SCREEN_NAMES = [
  "storyPrompt", "mappingReview", "imageGeneration", "videoPreview", "videoWorkflow", "sceneEdit", "narrationReview",
] as const;

export type PhotoCardSkippedScreenName = (typeof PHOTO_CARD_SKIPPED_SCREEN_NAMES)[number];

/**
 * Whether a card would be shown the "없는 단계입니다" notice instead of this screen.
 *
 * Takes a plain string so a caller that only knows one screen's name — a button deciding whether to render at
 * all — can ask without importing the router's union.
 */
export function isPhotoCardSkippedScreen(name: string): boolean {
  return (PHOTO_CARD_SKIPPED_SCREEN_NAMES as readonly string[]).includes(name);
}
