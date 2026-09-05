import { describe, expect, it } from "vitest";
import { EpisodeScriptsService } from "./episode-scripts.service.js";

/** The prompt builder is private; this reads it the way the service does, without a project on disk. */
const promptOf = (service: EpisodeScriptsService): string =>
  (service as unknown as { buildScriptPrompt(context: Record<string, unknown>, sceneCount: number, clipDurationSeconds: number): string })
    .buildScriptPrompt({}, 6, 5);

describe("what the paid script prompt refuses to ask for", () => {
  /**
   * Two rules that both came from watching finished video, not from reading code.
   *
   * Cowork compared frames from Episodes 4 and 5: replacing Opening/Main/Ending movement with Starts at /
   * Action / Ends at removed a visible 멈춤 → 급발진 → 순간이동 inside single five-second shots. But the same
   * instruction survived in another field — motion_speed came back as "정적 후 급격함" and "느림에서 빠름으로
   * 전환", and Episode 5 scene 6, written that way, blows out to white at 3.7 seconds.
   *
   * The other rule is the text one: the provider documents "the prompt asks for text" as a first cause of a
   * refused clip, and Episode 5 scene 3 was refused twice for $0.50 with a tape label as its first frame.
   */
  it("asks for one pace per shot, and for no on-screen writing", () => {
    const prompt = promptOf(new EpisodeScriptsService("/nowhere"));

    expect(prompt, "one state per scene, not a change part-way").toContain("motion_speed와 motion_intensity");
    expect(prompt).toContain("도중에 바뀌는 변화");
    expect(prompt, "and the way out when the story really does change pace").toContain("장면을 나누십시오");

    expect(prompt, "writing on screen is not the event of a scene").toContain("화면에 글자가 나타나는 것을 장면의 주된 사건");
    expect(prompt).toContain("영상 모델이 그리지 못합니다");
  });

  /** The rules are in the paid prompt itself, not only in a comment beside it. */
  it("puts them where the model actually reads them", () => {
    const prompt = promptOf(new EpisodeScriptsService("/nowhere"));
    const requirements = prompt.slice(prompt.indexOf("[5. 출력 요구사항]"));
    expect(requirements).toContain("motion_speed와 motion_intensity");
    expect(requirements).toContain("화면에 글자가 나타나는 것을");
  });
});
