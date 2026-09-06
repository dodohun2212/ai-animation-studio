/**
 * The two things a script model must know about the motion fields, in one place because two paths ask for them.
 *
 * A short project's fields come from `prompts/story/story_generation.txt`; a long project's Episode script comes
 * from `episode-scripts.service.ts`'s inline prompt. Episode 6 scene 6 failed at Runway on 2026-09-06 and the
 * first fix went into the template — which that Episode does not read. The place that was fixed and the place
 * that broke were different ones, and both were green.
 *
 * So the sentences live here and the template is checked against them (motion-field-rules.test.ts). A `.txt`
 * cannot import a constant, but it can be held to one.
 *
 * Why each exists:
 *
 * The length was only ever stated on the narration line, so the motion fields were written without knowing how
 * long the shot they become is. Nothing capped what could be asked of five seconds because nothing said there
 * were five — scene 6 asked for two camera moves and three deformations of a face.
 *
 * The stability rule is appended to every video request by `promptFor` (see STABILITY_RULE), and the model that
 * writes the motion never sees it. Scene 6's end_motion was a face being swallowed by glitch, sent under a line
 * demanding stable anatomy. Neither author was wrong on its own; they were never shown to each other.
 */
export function shotBudgetRule(clipDurationSeconds: number): string {
  return `움직임 항목(start_motion·main_motion·end_motion·camera_motion·environment_motion)은 장면당 ${clipDurationSeconds}초짜리 연속된 한 컷으로 만들어집니다. 시작 자세와 종료 자세 사이에 주요 동작 하나와 카메라 이동 하나가 들어갈 분량으로 쓰고, 한 컷에 여러 동작이나 여러 번의 카메라 전환을 넣지 마십시오.`;
}

/** The other half: what the video request will demand of whatever the motion fields describe. */
export const SUBJECT_SURVIVES_RULE = "영상 생성 요청은 인물의 정체성·신체·의상이 컷 내내 유지되도록 함께 요구합니다. 그러므로 얼굴이나 신체가 부서지거나 다른 것으로 바뀌거나 사라지는 변화는 움직임 항목에 쓰지 마십시오. 그런 사건이 이야기에 필요하면 description에 서술하고, 움직임 항목에는 그 직전까지의 동작만 쓰십시오.";

/** The placeholder the story template writes instead of a number, so the check can render one from the other. */
export const CLIP_DURATION_PLACEHOLDER = "$clip_duration_seconds";

/**
 * One pace per shot. Both fields render into the video prompt's single `Pacing` line, and the model kept
 * writing a change into them — 「정적 후 급격함」, 「느림에서 빠름으로 전환」 — which is the same three-beat
 * instruction the old Opening/Main/Ending labels carried, arriving by another door. Cowork read it off the
 * frames as 멈춤 → 급발진 in Episode 4, and Episode 5 scene 6 (느림에서 빠름으로 전환) blows out to white at
 * 3.7s. One five-second shot holds one pace.
 */
export const ONE_PACE_RULE = "motion_speed와 motion_intensity에는 장면 전체에 걸친 하나의 상태만 적으십시오. \"느림에서 빠름으로 전환\"처럼 도중에 바뀌는 변화나 두 가지 속도를 한 장면에 담지 마십시오. 속도가 달라져야 하는 이야기라면 장면을 나누십시오.";

/**
 * The video model cannot draw readable writing, and asking for it is one of the two documented causes of a
 * refused clip — the other being text already on the first frame. Both were met on 2026-09-05: one scene was
 * refused twice for $0.50, and two more came back with caption boards holding the shot for its whole length.
 */
export const NO_TEXT_AS_EVENT_RULE = "화면에 글자가 나타나는 것을 장면의 주된 사건으로 삼지 마십시오. 기록·라벨·자막·간판·파형처럼 읽히는 글자는 영상 모델이 그리지 못합니다. 그 내용이 뜻하는 바를 인물의 행동·표정·빛·구도로 보여 주십시오.";
