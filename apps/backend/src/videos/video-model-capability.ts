import type { VideoModel } from "@ai-animation-studio/shared";

/**
 * What a video model can be handed, declared once per model — block 1 of ③ (Cowork Rounds 737/738).
 *
 * 🔴 캡틴D: 「다른 영상 AI는 사진을 더 받거나 할 수도 있잖아」. Every design for the cut problem so far treated
 * "the video model takes one picture" as a constant. It is not; it is what Runway `gen4_turbo` takes today. A
 * model that is handed both the first and the last frame closes a cut by itself, and then the fallback this app
 * builds for one-picture models — editing the next still from the clip that just ended — is work the provider
 * already does, done again by hand at the cost of a re-encode per scene.
 *
 * So the question "how is this cut joined" has to be asked of the model, not assumed, and it is asked here and
 * nowhere else. The seam strategy reads this; nothing else in the pipeline is allowed to assume one picture.
 *
 * Exhaustive over `VideoModel` by type, the same guarantee `DIALECT` gives the prompt compiler: a model does not
 * compile until someone has said what it accepts.
 *
 * Deliberately one fact. Reference images, multi-shot and the rest are real capabilities of other providers, and
 * none of them has a consumer here yet — a field nobody reads is a promise with nothing behind it.
 */
export interface VideoModelCapability {
  /**
   * Whether the model can be told where a clip must *end*, by being handed its last frame.
   *
   * `false` for `gen4_turbo` because Runway's own documentation does not confirm it: `promptImage` is shown as a
   * single URL or data URI, and only third-party resellers describe a `position: "last"` form — one of them says
   * the Gen-4 line honours `"first"` only (checked 2026-09-11). It was never tried with a paid call, and after
   * 2026-09-12 there is no reason to: pinning a clip's end to the next still would stop the growth, because the
   * stills barely advance (docs/00_NOW.md ③). Unconfirmed is `false`, never `true` — a capability claimed wrongly
   * is a paid request built for something the provider does not do.
   */
  readonly acceptsLastFrame: boolean;
}

const CAPABILITY: Record<VideoModel, VideoModelCapability> = {
  gen4_turbo: { acceptsLastFrame: false },
};

export function videoModelCapability(model: VideoModel): VideoModelCapability {
  return CAPABILITY[model];
}
