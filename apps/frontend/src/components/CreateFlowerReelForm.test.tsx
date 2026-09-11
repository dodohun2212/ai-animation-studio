import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject, withStatus } from "../api/testUtils.js";
import { CreateFlowerReelForm } from "./CreateFlowerReelForm.js";

const project = makeProject({ id: "꽃말_장미" });

function fill() {
  fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
  fireEvent.change(screen.getByTestId("flower-meaning"), { target: { value: "열정" } });
}

/** Both calls succeed: create, then the preset save. */
function stubOk() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/projects") return jsonResponse(200, { project });
    if (url.endsWith("/settings")) {
      return jsonResponse(200, { project, settings: { projectName: "", topic: "", genre: "", mood: "", character: "", lore: "", fullStory: "", durationSeconds: 20, sceneCount: 2, clipDurationSeconds: 10, additionalNotes: "", styleNotes: {}, narrationEnabled: true, subtitlesEnabled: true } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CreateFlowerReelForm", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 This form writes a brief, not a script.
   *
   * An earlier version typed two fields per scene by hand and the image prompt came out empty — the prompts
   * read seventeen scene fields, and only story generation fills them. So what this asserts is that the flower
   * facts reach the *settings* the story prompt is built from, and that nothing here tries to author scenes.
   */
  it("creates an ordinary project and saves the flower brief into its settings", async () => {
    const fetchMock = stubOk();
    const onCreated = vi.fn();
    render(<CreateFlowerReelForm onCreated={onCreated} onCancel={() => {}} />);

    fill();
    fireEvent.click(screen.getByTestId("flower-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));
    expect(calls[0]!.url).toBe("/projects");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ projectId: "꽃말_장미", topic: "장미의 꽃말 — 열정" });

    const saved = JSON.parse(String(calls[1]!.init.body)) as { settings: Record<string, unknown> };
    const settings = saved.settings as { fullStory: string; sceneCount: number; clipDurationSeconds: number; styleNotes: Record<string, string>; narrationEnabled: boolean; sceneImageContinuityEnabled: boolean };
    expect(settings.fullStory).toContain("장미");
    // The growth arc and the sameness clause are the whole brief — an image prompt built without them draws a
    // different flower in every shot, which is the one failure this preset exists to fight.
    expect(settings.fullStory).toContain("씨앗");
    expect(settings.fullStory).toContain("같은 각도");
    /*
     * 🔴 캡틴D watched 개나리's clips and the plant did not grow. The brief described the arc ACROSS the reel
     * and said nothing about what has to happen inside one five-second clip, so the story model filled every
     * scene with `motion_speed: 느림` / `motion_intensity: 약함` and a slow push-in — a shot where the light and
     * the background move and the plant stands still. Those two fields go to Runway verbatim.
     *
     * Asserted as the checkable half — a difference between the first and last frame — rather than the adjective.
     */
    expect(settings.fullStory).toContain("타임랩스");
    expect(settings.fullStory).toContain("첫 프레임과 마지막 프레임");
    // One step per scene, and the next scene starts where this one stopped: the chain the images already follow.
    expect(settings.fullStory).toContain("한 단계만");
    /*
     * 🔴 The brief used to open with 「씨앗이 흙에 심기는 데서 시작해」, and the story model did exactly that:
     * scene 1 of the sunflower reel spent its five seconds burying a seed, and its last frame was a grey mound
     * of soil — no plant at all — before cutting to a sprout. Four scenes with one spent on planting leaves
     * three to carry the whole growth, which is what made every cut jump.
     *
     * Both halves are pinned, because moving the start without forbidding the old one is how a brief drifts
     * back: this preset has already had to re-learn that twice (the camera's 「아주 느린 접근」, and pacing).
     */
    expect(settings.fullStory).toContain("이미 심긴");
    expect(settings.fullStory).toContain("씨앗을 심거나 흙으로 덮는 장면은 넣지 않는다");
    expect(settings.fullStory).not.toContain("심기는 데서 시작");
    // 🔴 The camera line asked for 「아주 느린 접근」 and the model applied that slowness to the subject too.
    // A locked-off camera also removes Runway's cheapest way to look like it moved without growing anything.
    expect(settings.styleNotes.camera).toContain("움직이지 않는다");
    expect(settings.styleNotes.camera).not.toContain("느린");
    expect(settings.styleNotes.avoid).toContain("장면마다 바뀌는 것");
    // 씨앗 → 싹 → 봉오리 → 개화. Two scenes jumped from a sprout to an open flower in one cut, and that jump
    // survived however steady the pot was kept; the video cost is unchanged and the images cost $0.20 more.
    expect(settings.sceneCount).toBe(4);
    expect(settings.clipDurationSeconds).toBe(5);
    // Hardcoded now rather than read off a select, so this is the only thing holding the preset's shape.
    expect(settings.styleNotes.aspect).toBe("9:16");
    /**
     * 🟠 CLI Round 662 ②. The old form wrote the lower bound into the code —
     * `SCENE_COUNTS.filter((v) => v >= MIN_SCENE_COUNT)` — so a contract that moved broke the build. Two of the
     * three constants that replaced it kept a compile-time check of their own, because their contract types are
     * unions: `RunwayClipDurationSeconds` is `5 | 10` and `AspectRatio` is `"9:16" | "16:9"`, and the constants
     * are declared as those types. The scene count is the one that did not — MIN/MAX_SCENE_COUNT are plain
     * numbers with no union type to annotate against, so `FLOWER_SCENE_COUNT = 4` is just `number` and a
     * contract that moved would pass silently. This is that check, moved from compile time to here.
     */
    expect(settings.sceneCount).toBeGreaterThanOrEqual(MIN_SCENE_COUNT);
    expect(settings.sceneCount).toBeLessThanOrEqual(MAX_SCENE_COUNT);
    expect(RUNWAY_CLIP_DURATIONS).toContain(settings.clipDurationSeconds);
    expect(settings.narrationEnabled).toBe(true);
    // The preset turns the chain on, which is the setting's whole distinction: one flower, one pot, one
    // forward movement. The brief above asks for 「같은 화분」 and this is what lets the pictures obey it.
    expect(settings.sceneImageContinuityEnabled).toBe(true);
    // durationSeconds is derived server-side and rejected as an unsupported field if sent.
    expect(settings).not.toHaveProperty("durationSeconds");
  });

  it("passes a typed origin through, and leaves it out when blank", async () => {
    const fetchMock = stubOk();
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    fill();
    fireEvent.change(screen.getByTestId("flower-origin"), { target: { value: "그리스 신화에서 유래한다" } });
    fireEvent.click(screen.getByTestId("flower-submit"));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    const settings = (JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)) as { settings: { fullStory: string } }).settings;
    expect(settings.fullStory).toContain("그리스 신화에서 유래한다");
  });

  /**
   * 🔴 The money sentence has to match what the button does.
   *
   * While this form wrote the script itself it truthfully said 비용이 들지 않습니다. The script now comes from
   * a paid call, so that sentence would be a promise the screen no longer keeps — on the button that spends.
   */
  it("says the script generation charge is next, not that this is free", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    const note = screen.getByTestId("flower-cost-note").textContent ?? "";
    expect(note).toContain("$0.05");
    expect(note).not.toContain("비용이 들지 않습니다");
    // And the origin field says where a wrong fact gets corrected, before any image is bought.
    expect(screen.getByTestId("flower-origin-note").textContent).toContain("이미지를 만들기 전에");
  });

  /**
   * The whole price, before the first cent — and the shape that price is for.
   *
   * Every step already names its own charge, which is why nobody ever saw the total: it arrived in four pieces,
   * each after the previous one was spent. 캡틴D finished a reel and only then knew what a reel costs.
   *
   * 🔴 This test used to move the number by driving 장면 수 and 장면당 길이 selects on this form. Those are gone.
   * ShortProjectSettingsScreen — which opens the instant this form succeeds, via handleCreated — asks for the
   * same three values, and asks for them *unlocked*: the server derives sceneCountChangeable from
   * `stored.scenes.length === 0` and aspectRatioChangeable from `stored.generated_images.length === 0`, and a
   * project this form just made has neither. So the second screen was never a later moment the first one was
   * needed for; it was the next screen with the same controls. Asking twice in a row is what made this form
   * long. What has to stay true is that the preset itself did not change and that the total says where it moves.
   */
  it("states the preset's whole estimated cost and does not ask for the shape twice", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    // 0.05 script + 4 x 0.10 images + 20s x 0.05 video
    const total = screen.getByTestId("flower-total-cost").textContent ?? "";
    expect(total).toContain("$1.45");
    // A fixed total that silently stops being the total is the failure this line was added to prevent.
    expect(total).toContain("설정 화면");

    expect(screen.getByTestId("flower-shape-note").textContent).toContain("4장면 × 5초 = 20초");
    expect(screen.queryByTestId("flower-scene-count")).toBeNull();
    expect(screen.queryByTestId("flower-clip-duration")).toBeNull();
    expect(screen.queryByTestId("flower-aspect")).toBeNull();
  });

  it("suggests a folder name from the flower and keeps a typed one", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
    expect((screen.getByTestId("flower-project-id") as HTMLInputElement).value).toBe("꽃말_장미");

    fireEvent.change(screen.getByTestId("flower-project-id"), { target: { value: "rose_01" } });
    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "수국" } });
    expect((screen.getByTestId("flower-project-id") as HTMLInputElement).value).toBe("rose_01");
  });

  /**
   * 🔴 Only the first of the two calls is irreversible.
   *
   * When the preset save fails the folder already exists, so retrying must not create it again — pressing the
   * button a second time would only ever get PROJECT_ALREADY_EXISTS about the project this screen just made.
   */
  it("says the project was made when only the preset failed, and retries just the preset", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/projects") return jsonResponse(200, { project });
      return withStatus(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" }) as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    fill();
    fireEvent.click(screen.getByTestId("flower-submit"));

    const partial = await screen.findByTestId("flower-partial");
    expect(partial.textContent).toContain("꽃말_장미");
    expect(screen.getByTestId("flower-submit").textContent).toContain("다시 저장");

    fireEvent.click(screen.getByTestId("flower-submit"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(3));
    // Three calls, and only one of them was the create.
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/projects")).toHaveLength(1);
  });

  it("does not submit until the flower and its meaning are filled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    expect((screen.getByTestId("flower-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("flower-submit"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
