import { RUNWAY_PROMPT_AUTHORING_LIMIT, VIDEO_MODELS, type VideoModel, type RunwayVideoRatio } from "@ai-animation-studio/shared";

import { videoPreviewDataInvalid } from "./video-preview-api.error.js";

/**
 * One compile path from a stored scene to the text a video provider is actually sent.
 *
 * Everything that renders, records, re-renders or compares a video prompt goes through `compileVideoPrompt`:
 * the short project's preview and submission, the Long Episode's preview and submission, and the staleness
 * recompute that decides whether a finished clip is behind its scene. That is the property worth having — the
 * badge saying 「장면 내용이 바뀐 뒤로 이 영상을 다시 만들지 않았습니다」 is only true while the recompute and the
 * original submission speak the same grammar, and a second compile path is how those two quietly diverge.
 *
 * 🔴 The grammar belongs to the model, not to this app. Runway's Gen-4 guide is why this dialect sends no
 * restated subject description (the first frame carries it, and restating it "can lead to reduced motion or
 * unexpected results") and why it never sends negative phrasing — the image side does exactly the opposite,
 * handing OpenAI an explicit `Avoid:` line, because OpenAI reads negatives and Runway does not. A second
 * provider inherits none of that, so it gets its own function here rather than a flag inside this one.
 *
 * Deliberately small: a dialect is a function from scene to text, and nothing else. No scene DSL, no
 * per-model option bag, no capability flags — an option this app cannot actually send is a promise the
 * screen would make on the adapter's behalf, and `docs/06_DECISIONS.md` already records what a quoted-but-
 * unsupported value costs.
 *
 * 🟠 The dialect is not in `packages/shared`, and that was decided rather than skipped. A screen can truthfully
 * show a model's name, price, ratios and maximum length — `VideoModelOption` already carries all four — but
 * "which prompt grammar does the server use" is not something a person can act on, and a contract field with
 * no consumer is the kind of promise the frontend ends up rendering because it is there. It moves to shared on
 * the day a screen has a true sentence to build from it.
 */

/** The grammar each model reads. Exhaustive over `VideoModel` by type, so a new model does not compile until
 * someone has said which grammar it speaks — a stronger guarantee than a test, and the reason this map is
 * written out rather than derived. */
export type VideoPromptDialect = "runway_gen4";
const DIALECT: Record<VideoModel, VideoPromptDialect> = {
  gen4_turbo: "runway_gen4",
  // 🟠 H3 Max reads the same text for now — a decision on what was found, and not yet a confirmed fit.
  // What MiniMax publishes (read 2026-09-12): a `[command]` camera syntax ([Pan left], [Push in], [Static shot]
  // … 15 in all) that its image-to-video API reference lists for the Hailuo-2.3 / Hailuo-02 / I2V-01-Director
  // models, NOT for H3 or H3 Max; its guide shows bracket camera cues only under H3 *text*-to-video; and it
  // says natural-language camera description works too. Runway's developer docs have no per-model prompting
  // guide at all. So nothing published says H3 Max image-to-video wants brackets, and mapping our free-text
  // `camera_motion` onto fifteen fixed commands would be a guess sent to a paid model. The gen4 grammar's two
  // provider choices — no restated subject (the first frame carries it), no negative phrasing — suit any model
  // given an exact first frame. `promptExpansionMode: "disabled"` (the adapter) makes H3 follow this text as
  // written, and one grammar keeps the staleness recompute true (see `promptFor`).
  // The first H3 reel is the check. If its camera does not follow the "Motivated camera" line, H3 gets its own
  // dialect here — and `promptFor` has to recompute against the recorded model first (both pipelines' records
  // now carry it).
  h3_max_480p: "runway_gen4",
  h3_max_768p: "runway_gen4",
};

/** Which grammar a model reads — exported for the test that holds the staleness recompute's assumption. */
export const videoPromptDialect = (model: VideoModel): VideoPromptDialect => DIALECT[model];

export const SCENE_FIELDS = [
  "number", "description", "visual_action", "start_motion", "main_motion", "end_motion",
  "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion",
  "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint",
] as const;

/**
 * "narration" is a scene field used only by narration/TTS generation, never by the video prompt (see promptFor
 * below — it reads none of the fields here). It is deliberately NOT in SCENE_FIELDS: scenes stored before this
 * field existed have exactly SCENE_FIELDS.length keys and must keep working. It is accepted here only so the
 * strict "no unexpected keys" check below does not reject newer scenes that do carry it.
 */
export const OPTIONAL_SCENE_FIELDS = ["narration"] as const;

/**
 * Not the provider's 1,000: the room left after the no-legible-text rule the adapter appends to every prompt on
 * its way out (RUNWAY_PROMPT_AUTHORING_LIMIT's comment says why the room is reserved rather than checked later).
 */
const UTF16_PROMPT_LIMIT = RUNWAY_PROMPT_AUTHORING_LIMIT;

export type StoredScene = Record<(typeof SCENE_FIELDS)[number], string | number> & { narration?: string };

/** Equivalent to JavaScript's UTF-16 code-unit count used by the Python UI. */
export function utf16Length(value: string): number {
  return value.length;
}

export interface VideoPromptResult {
  prompt: string;
  /** Section labels actually dropped by the length-truncation loop below — never includes "Continuity cue" for
   * scene 1, which is absent for an unrelated reason (there is no previous scene) rather than truncated. Lets a
   * caller that cares (video-preview.service.ts's preview()) tell the user something was cut, instead of quietly
   * shipping a prompt with content missing and no way to know. */
  omittedSections: string[];
}

/** Exactly what a dialect reads. A compiler that wants more than this is describing a different feature. */
export interface VideoPromptInput {
  scene: StoredScene;
  /** Scene N-1, for the continuity cue. Absent for scene 1 by definition, not by omission. */
  previous: StoredScene | undefined;
  ratio: RunwayVideoRatio;
  clipDurationSeconds: number;
}

/**
 * The one line every video request ends with, and the only line in the prompt that is the same for every scene.
 *
 * Compared apart from the scene, for the reason the image side already worked out: a constant rule inside the
 * recorded text is a rule the staleness check reads as content. `NO_LEGIBLE_TEXT_RULE` is kept out of the image
 * record entirely and its comment says why — a constant line added to it would mark every picture ever generated
 * as behind its own script. The video side put its rule inside the rendered prompt instead, and
 * `describesSameScene` compares a line with no ': ' as a whole value, so this line was compared as though
 * someone had written it about this scene.
 *
 * Measured: rendering it with one word changed reports a different scene. Editing this sentence would have
 * marked all thirty-six recorded video prompts on disk as 장면 내용이 바뀐 뒤로 다시 만들지 않았습니다, false for
 * every one of them — the defect found on 2026-09-05 in the first line, still sitting in the last. The prefix
 * was examined then and the suffix was not.
 *
 * It stays in the text that is recorded and sent, because that is what was actually asked of the provider. Only
 * the comparison strips it, so the sentence can be fixed later without telling every existing clip that its
 * scene was rewritten. Episode 6 scene 6 is why that matters: this line demands stable anatomy while the story
 * model had written a face being swallowed, and the two cannot both be obeyed.
 */
export const STABILITY_RULE = "Maintain stable identity, anatomy, clothing, essential objects, lighting and scene continuity throughout the shot.";

/**
 * Whether two rendered video prompts describe the same scene — the question staleness is actually asking.
 *
 * The badge this feeds says "장면 내용이 바뀐 뒤로 이 영상을 다시 만들지 않았습니다", so it must fire when the
 * scene changed and stay quiet otherwise. Comparing the two prompts as whole strings also fires when *this file*
 * changes: renaming "Opening movement" to "Starts at" would have put that badge on all twenty-four of 캡틴D's
 * existing clips while every scene was untouched — the app asserting a cause it had not checked, which is the
 * defect this repository has spent a week removing.
 *
 * So only the values are compared, never the labels. A section that gains or
 * loses content still counts, because its value moves; a section that is only renamed does not, because nothing
 * a person wrote is different.
 *
 * This does mean a relabelled prompt is not reported. That is the honest reading: the clip on disk was made from
 * the same scene, and whether a new label would draw it better is a question no comparison here can answer —
 * only regenerating it can, and that is the person's money to spend.
 */
export function describesSameScene(recorded: string, recomputed: string): boolean {
  // The closing rule is dropped by shape, not by its current wording: matching the exact sentence would only
  // strip it from whichever side already has today's version, and the comparison that matters is an old record
  // against a reworded recompute. Every section renders as `Label: value`, so a final line with no separator is
  // that rule and nothing else. The first line has no separator either and is deliberately left in — that is how
  // videoPromptDrift tells a clip-length or orientation change apart from a scene edit.
  const withoutClosingRule = (lines: string[]) => lines.length > 1 && !lines[lines.length - 1]!.includes(": ")
    ? lines.slice(0, -1)
    : lines;
  const values = (prompt: string) => withoutClosingRule(prompt.split("\n"))
    .map((line) => { const at = line.indexOf(": "); return at < 0 ? line : line.slice(at + 2); }).join("\n");
  return values(recorded) === values(recomputed);
}

/**
 * Why a recorded video prompt no longer matches the one a resubmission would send.
 *
 * The first line is not fixed, although this file used to say it was: it carries the clip length and the
 * orientation, and both are project-wide settings. Changing the clip length from 5 to 10 seconds — a setting with
 * no guard on either project type — rewrites that line in every prompt ever recorded. Measured before it was
 * written: with two scenes generated and nothing else touched, videoStale went from [] to [1, 2] on that save
 * alone. There are thirty-six recorded video prompts on disk today and every one carries that line.
 *
 * "장면 내용이 바뀐 뒤로" is false for all of them. The clips genuinely are behind — they are the wrong length —
 * so the warning must still fire; only the reason it gave was wrong.
 *
 * The scene comparison is unchanged. This only asks, when the two differ, whether the difference is confined to
 * that first line.
 */
export type VideoPromptDrift = "current" | "format" | "scene";

export function videoPromptDrift(recorded: string, recomputed: string): VideoPromptDrift {
  if (describesSameScene(recorded, recomputed)) return "current";
  const withoutFormatLine = (prompt: string) => prompt.split("\n").slice(1).join("\n");
  return describesSameScene(withoutFormatLine(recorded), withoutFormatLine(recomputed)) ? "format" : "scene";
}

/**
 * Deliberately sends no character/subject description at all — the first-frame image already carries that, and
 * Runway's own Gen-4 Video Prompting Guide warns that "reiterating elements that exist within the image in high
 * detail can lead to reduced motion or unexpected results." This function's sections are all motion/camera/
 * pacing description for exactly that reason; `suffix` below ("Maintain stable identity...") is what actually
 * holds identity steady, not a redundant physical description (raised as a possible
 * gap, verified against Runway's own docs, and closed as intentional design instead).
 *
 * Also never add negative phrasing here (an `Avoid: ...` line, the way image-prompt.ts's styleLineFor() does for
 * OpenAI) — the same guide: "Gen-4 is designed to interpret prompts that describe what should happen... Negative
 * phrasing is not supported and may produce unpredictable or even opposite results." The image side's Avoid
 * pattern does not transfer here; Runway is a different model with the opposite behavior for negatives.
 */
function compileRunwayGen4({ scene, previous, ratio, clipDurationSeconds }: VideoPromptInput): VideoPromptResult {
  const orientation = ratio === "1280:720" ? "horizontal" : "vertical";
  const continuity = previous
    ? [previous.end_motion, previous.continuity_hint].filter((value, index, values) => values.indexOf(value) === index).join(" ")
    : "";
  const sections: Array<[string, string]> = [
    ["Continuity cue", continuity],
    // Poses, not movements. The script template asks for a pose at each end — "장면 시작 순간의 자세·시선·이동
    // 상태" and "마지막 1초에 도달해야 할 자세" — and these labels asked the model for movement three times in
    // five seconds. A model reads its labels: three movements in a five-second shot is a shot that starts, stops
    // and starts again, which is what 캡틴D described as 부분부분 어색한 파트 (Cowork Round 492, approved by
    // 캡틴D as the redesign to try first). One action between two held poses is the shape the fields describe.
    //
    // It also makes the continuity cue legible: that line hands over the previous scene's end_motion, so
    // "Starts at" is literally where the last shot left off.
    ["Starts at", String(scene.start_motion)],
    ["Action", String(scene.main_motion)],
    ["Performance", String(scene.expression_change)],
    ["Ends at", String(scene.end_motion)],
    ["Motivated camera", String(scene.camera_motion)],
    ["Environment", String(scene.environment_motion)],
    ["Pacing", `motion speed ${scene.motion_speed}; intensity ${scene.motion_intensity}`],
  ];
  const prefix = `Create one continuous cinematic ${clipDurationSeconds}-second ${orientation} image-to-video shot from the supplied exact first frame.`;
  const render = (included: readonly [string, string][]) => [prefix, ...included.map(([label, value]) => `${label}: ${value}`), STABILITY_RULE].join("\n");
  // "Pacing" is the one section this filter cannot see into: it is built as a template, so two blank fields
  // would still render "motion speed ; intensity " and pass. That case does not arise — parseScenes above and
  // episode-videos.service.ts's scenes() both reject any scene field that is blank, so nothing that generates
  // a video can reach here with one. The staleness recompute (projects/scene-staleness.ts) does not validate,
  // and there a blanked field makes the scene read as behind its recorded prompt, which is what it is.
  // Scene 1 has no `previous` by definition, so "Continuity cue" is always "" there — sent unfiltered, every
  // project's scene 1 prompt carried a bare "Continuity cue: " line with nothing after the colon. Matches
  // imagePromptFor's existing filter for the same class of empty-section bug on the image side.
  let included = sections.filter(([, value]) => value);
  const removable = ["Pacing", "Environment", "Performance", "Continuity cue"];
  const omittedSections: string[] = [];
  while (utf16Length(render(included)) > UTF16_PROMPT_LIMIT && removable.length > 0) {
    const label = removable.shift()!;
    const before = included.length;
    included = included.filter(([candidate]) => candidate !== label);
    if (included.length !== before) omittedSections.push(label);
  }
  const prompt = render(included);
  if (utf16Length(prompt) > UTF16_PROMPT_LIMIT) throw videoPreviewDataInvalid();
  return { prompt, omittedSections };
}


/**
 * The registry. One entry per dialect, and adding a model means adding its function here and its own tests —
 * nothing else in this file moves.
 */
const COMPILERS: Record<VideoPromptDialect, (input: VideoPromptInput) => VideoPromptResult> = {
  runway_gen4: compileRunwayGen4,
};

/**
 * Compile one scene for one model.
 *
 * 🔴 A model with no compiler throws rather than falling back to the gen4 text. Sending Runway's grammar to a
 * provider that does not read it would spend real money on a request built for someone else, and the failure
 * would arrive as a bad clip rather than as an error — the shape this repository keeps paying for. It cannot
 * be reached through the settings screen: `resolveVideoModel` only ever answers with a `VIDEO_MODELS` member,
 * `DIALECT` does not compile unless every member names a grammar, and `every registered video model has a
 * prompt compiler` in the tests covers the last step. The throw is for the gap between those facts, not for a
 * user.
 */
export function compileVideoPrompt(model: VideoModel, input: VideoPromptInput): VideoPromptResult {
  const compiler = COMPILERS[DIALECT[model]];
  if (!compiler) throw videoPreviewDataInvalid();
  return compiler(input);
}

/**
 * Today's single dialect, kept as a name so the callers that genuinely have no model in hand say so.
 *
 * 🟠 There is exactly one such caller shape and it is the staleness recompute: a recorded clip was made with
 * whichever model was selected then. While every registered model reads one grammar, "today's model" and "the
 * model that made it" compile the same text. `video-prompt-compiler.test.ts` fails the day a model with a second
 * grammar is registered, because that is the day this stops being true and every clip made by the other model
 * would read as 「장면 내용이 바뀌었다」 for a reason no person caused.
 */
export const promptFor = (scene: StoredScene, previous: StoredScene | undefined, ratio: RunwayVideoRatio, clipDurationSeconds: number): VideoPromptResult =>
  compileVideoPrompt(VIDEO_MODELS[0], { scene, previous, ratio, clipDurationSeconds });
