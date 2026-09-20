import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegMergeEngine, MediaToolError, probeClipFacts, runMediaCommand, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
import { escapeForFfmpegFilterPath } from "./subtitle-file.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

/**
 * Snapshots the subtitle files each ffmpeg call can see, at the moment it runs.
 *
 * The merge deletes `normalized/` once the final file exists — it is a cache, and a second full-size copy of
 * every finished video is not something to leave in a person's data folder. These tests were reading the .ass
 * files out of that directory *after* the merge, so they depended on debris surviving rather than on what the
 * merge did. Same assertions, read at the only moment they are actually true.
 */
async function captureAss(target: string, into: Map<string, string>): Promise<void> {
  const directory = path.dirname(target);
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  for (const name of names.filter((item) => item.endsWith(".ass"))) {
    into.set(name, await fs.readFile(path.join(directory, name), "utf8"));
  }
}

function runner(calls: string[][], ass: Map<string, string> = new Map()): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_]; calls.push(args);
    await captureAss(args.at(-1)!, ass);
    await fs.writeFile(args.at(-1)!, Buffer.from("rendered"));
    return { stdout: "", stderr: "" };
  };
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-merge-")); roots.push(root);
  return { root, finalPath: path.join(root, "videos", "final", "instagram_reel.mp4"), fontsDir: path.join(root, "fonts") };
}

/*
 * VideoReview.clip — what a clip on disk is, measured. The merge screen's bars sentence reads it when present, so
 * it has to be right for both halves (shape and sound), and has to step aside rather than fail a review.
 */
describe("probeClipFacts", () => {
  const answering = (streams: unknown[]): MediaCommandRunner => async () => ({ stdout: JSON.stringify({ streams }), stderr: "" });

  it("reads the picture's size and whether there is a sound track", async () => {
    expect(await probeClipFacts("a.mp4", answering([{ codec_type: "video", width: 768, height: 1152 }, { codec_type: "audio" }])))
      .toEqual({ width: 768, height: 1152, hasAudio: true });
    expect(await probeClipFacts("a.mp4", answering([{ codec_type: "video", width: 720, height: 1280 }])))
      .toEqual({ width: 720, height: 1280, hasAudio: false });
  });

  it("answers nothing, rather than failing, when the file cannot be read as a video", async () => {
    expect(await probeClipFacts("a.mp4", answering([{ codec_type: "audio" }]))).toBeNull();
    expect(await probeClipFacts("a.mp4", async () => ({ stdout: "not json", stderr: "" }))).toBeNull();
    expect(await probeClipFacts("a.mp4", async () => { throw new MediaToolError("unavailable", "not installed"); })).toBeNull();
  });

  it("measures a real clip with the real ffprobe", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "clip-facts-")); roots.push(root);
    const withSound = path.join(root, "with.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=256x384:d=1", "-f", "lavfi", "-i", "sine=frequency=330:duration=1",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", withSound]);
    const silent = path.join(root, "silent.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=256x384:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);

    expect(await probeClipFacts(withSound)).toEqual({ width: 256, height: 384, hasAudio: true });
    expect(await probeClipFacts(silent)).toEqual({ width: 256, height: 384, hasAudio: false });
  });
});

/*
 * MergeAudioSettings.clipVolume — the clip's own sound under narration or alone, faded at the scene's edges and
 * brought to the anullsrc format so every normalised scene joins the same way.
 */
describe("FfmpegMergeEngine.merge clip sound", () => {
  const graphOf = (call: string[]) => call[call.indexOf("-filter_complex") + 1]!;

  it("lays the clip's sound under the narration at its level, faded at both edges, without amix's normalisation", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner(calls), fontsDir).merge([{ clip: "scene1.mp4", narrationAudioPath: "n1.mp3", clipAudioVolume: 0.3 }], 5, finalPath, "9:16");
    const call = calls.find((args) => args.includes("-filter_complex"))!;
    expect(graphOf(call)).toBe("[1:a]apad[narr];[0:a]volume=0.3,afade=t=in:st=0:d=0.15,afade=t=out:st=4.850:d=0.15[clip];[narr][clip]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,apad,aformat=sample_rates=48000:channel_layouts=stereo[aout]");
    expect(call).toContain("n1.mp3");
    expect(call).not.toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });

  it("carries a clip's sound into the next scene instead of fading it out at the cut, even into a scene without its own", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner(calls), fontsDir).merge([{ clip: "scene1.mp4", clipAudioVolume: 1 }, { clip: "scene2.mp4" }], 5, finalPath, "9:16");
    const [first, second] = calls.filter((args) => args.includes("-vf"));
    // No fade-out at scene 1's end: scene 2 opens on it.
    expect(graphOf(first!)).toBe("[0:a]volume=1,afade=t=in:st=0:d=0.15,apad,aformat=sample_rates=48000:channel_layouts=stereo[aout]");
    expect(first).not.toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    // Scene 2 has no sound of its own, so it holds only scene 1's tail, played back from the cut and fading away.
    expect(second!.slice(second!.indexOf("-sseof"), second!.indexOf("-sseof") + 4)).toEqual(["-sseof", "-0.500", "-i", "scene1.mp4"]);
    expect(graphOf(second!)).toBe("[1:a]areverse,volume=1,afade=t=out:st=0:d=0.500:curve=qsin,apad,aformat=sample_rates=48000:channel_layouts=stereo[aout]");
    expect(second).not.toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });

  /*
   * Cowork Round 881: the sound cut out at every scene — each clip faded out and the next faded in, a 0.3-second
   * hole every five seconds. Now a sounding clip's sound crosses into the next scene, equal-power, and only the
   * reel's last clip fades out.
   */
  it("crosses each clip's sound into the next at equal power, with the narration still under it", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner(calls), fontsDir).merge(
      [{ clip: "scene1.mp4", clipAudioVolume: 0.5 }, { clip: "scene2.mp4", clipAudioVolume: 0.5, narrationAudioPath: "n2.mp3" }, { clip: "scene3.mp4", clipAudioVolume: 0.5 }],
      5, finalPath, "9:16");
    const [, second, third] = calls.filter((args) => args.includes("-vf"));
    expect(second!.filter((arg, index) => second![index - 1] === "-i")).toEqual(["scene2.mp4", "n2.mp3", "scene1.mp4"]);
    expect(graphOf(second!)).toBe("[1:a]apad[narr];[0:a]volume=0.5,afade=t=in:st=0:d=0.500:curve=qsin[clip];[2:a]areverse,volume=0.5,afade=t=out:st=0:d=0.500:curve=qsin[tail];[narr][clip][tail]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,apad,aformat=sample_rates=48000:channel_layouts=stereo[aout]");
    // The last clip is the only one that fades out, since nothing follows to carry it.
    expect(graphOf(third!)).toBe("[0:a]volume=0.5,afade=t=in:st=0:d=0.500:curve=qsin,afade=t=out:st=4.850:d=0.15[clip];[1:a]areverse,volume=0.5,afade=t=out:st=0:d=0.500:curve=qsin[tail];[clip][tail]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,apad,aformat=sample_rates=48000:channel_layouts=stereo[aout]");
  });

  it("keeps the sound steady across a cut between two clips that sound alike", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "clip-seam-real-")); roots.push(root);
    // Two clips of the same steady noise, as two scenes of one place sound: the cut is at 2 seconds.
    const clips: string[] = [];
    for (const [index, seed] of [11, 29].entries()) {
      const clip = path.join(root, `scene${index + 1}.mp4`);
      await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=2", "-f", "lavfi", "-i", `anoisesrc=color=pink:seed=${seed}:amplitude=0.3:duration=2:sample_rate=48000`,
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip]);
      clips.push(clip);
    }
    const finalPath = path.join(root, "final", "instagram_reel.mp4");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await new FfmpegMergeEngine().merge(clips.map((clip) => ({ clip, clipAudioVolume: 1 })), 2, finalPath, "9:16");

    const levelOf = async (start: number, seconds: number): Promise<number> => {
      const { stderr } = await runMediaCommand(["ffmpeg", "-ss", start.toFixed(3), "-t", seconds.toFixed(3), "-i", finalPath, "-af", "volumedetect", "-vn", "-f", "null", "-"]);
      return Number(/mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr)?.[1] ?? NaN);
    };
    const steady = await levelOf(0.8, 0.4);
    const atTheCut = await levelOf(1.9, 0.2);
    expect(steady, "the clip's sound is in the reel").toBeGreaterThan(-40);
    expect(atTheCut, "and does not drop out where the scenes meet").toBeGreaterThan(steady - 3);
  }, 120000);

  it("puts audible clip sound into a real file, next to a silent scene, and joins them", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "clip-sound-real-")); roots.push(root);
    const withSound = path.join(root, "scene1.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=2", "-f", "lavfi", "-i", "sine=frequency=330:duration=2:sample_rate=44100",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", withSound]);
    const silent = path.join(root, "scene2.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
    const meanVolume = async (file: string): Promise<number> => {
      const { stderr } = await runMediaCommand(["ffmpeg", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
      return Number(/mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr)?.[1] ?? NaN);
    };
    const mergeInto = async (label: string, scenes: MergeSceneInput[]) => {
      const finalPath = path.join(root, label, "instagram_reel.mp4");
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await new FfmpegMergeEngine().merge(scenes, 2, finalPath, "9:16");
      return finalPath;
    };

    const withClipSound = await mergeInto("with", [{ clip: withSound, clipAudioVolume: 1 }, { clip: silent }]);
    const without = await mergeInto("without", [{ clip: withSound }, { clip: silent }]);

    expect(await meanVolume(withClipSound), "the tone is in the reel").toBeGreaterThan(-40);
    expect(await meanVolume(without), "and was not before").toBeLessThan(-80);
  });
});

describe("FfmpegMergeEngine.merge narration audio mixing", () => {
  /*
   * 🔴 The bars on the first chained reel (h3_max_768p returns 2:3 from a 2:3 picture) — FRAME_FITS. `fill`
   * covers the frame and cuts at the centre; the default stays the merge as it always was.
   */
  it("fills the frame and cuts at the centre when asked, and pads by default", async () => {
    for (const [options, expected, absent] of [
      [{ frameFit: "fill" as const }, "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=30,format=yuv420p", "pad="],
      [{}, "scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p", "crop="],
    ] as const) {
      const calls: string[][] = [];
      const { finalPath, fontsDir } = await setup();
      await new FfmpegMergeEngine(runner(calls), fontsDir).merge([{ clip: "scene1.mp4" }, { clip: "scene2.mp4" }], 5, finalPath, "9:16", options);
      const normalize = calls.filter((args) => args.includes("-vf"));
      expect(normalize, JSON.stringify(options)).toHaveLength(2);
      for (const call of normalize) {
        expect(call[call.indexOf("-vf") + 1], JSON.stringify(options)).toBe(expected);
        expect(call[call.indexOf("-vf") + 1]).not.toContain(absent);
      }
    }
  });

  /*
   * 캡틴D's landscape reel turned a quarter clockwise, so a 16:9 video fills a 9:16 Reel with nothing cut and no
   * bars (Cowork Round 866). The turn comes after the subtitles, so the text turns with the picture.
   */
  it("turns every scene a quarter clockwise after its subtitles when asked, and not otherwise", async () => {
    for (const rotateClockwise of [true, false]) {
      const calls: string[][] = [];
      const { finalPath, fontsDir } = await setup();
      await new FfmpegMergeEngine(runner(calls), fontsDir).merge(
        [{ clip: "scene1.mp4", subtitleText: "문장" }, { clip: "still.png", stillDurationSeconds: 5 }], 5, finalPath, "16:9", { rotateClockwise });
      const filters = calls.filter((args) => args.includes("-vf")).map((call) => call[call.indexOf("-vf") + 1]!);
      expect(filters).toHaveLength(2);
      for (const filter of filters) {
        if (rotateClockwise) expect(filter.endsWith(",transpose=clock"), filter).toBe(true);
        else expect(filter).not.toContain("transpose");
      }
      if (rotateClockwise) expect(filters[0]!.indexOf("subtitles=")).toBeLessThan(filters[0]!.indexOf("transpose="));
    }
  });

  it("uses anullsrc silence when a scene has no narration file, unchanged from before narration existed", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16");
    const normalizeCall = calls.find((args) => args.includes("scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"))!;
    expect(normalizeCall).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(normalizeCall).not.toContain("apad");
  });

  /**
   * The encoder is told what to do, on both branches, and the scaler is told how to enlarge.
   *
   * Left on x264's defaults this re-encoded Runway's already-compressed clips at CRF 23 after scaling them up
   * 2.25x, and Cowork measured what that costs on Episode 4: 0.126 bits per pixel arriving, 0.055 leaving
   * (Round 481). More pixels, less to fill them with. The settings are the fix, so they are what this holds —
   * a filter assertion alone would go green with the encoder quietly back on its defaults, which is the state
   * this whole change is about.
   *
   * Both branches, because a scene with narration and a scene without are encoded by two separate calls, and a
   * setting threaded through one of two is the shape this repository keeps finding.
   */
  it("encodes scenes at the chosen quality and scales up with lanczos, narration or not", async () => {
    for (const scene of [{ clip: "scene1.mp4" }, { clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3" }]) {
      const calls: string[][] = [];
      const { finalPath, fontsDir } = await setup();
      await new FfmpegMergeEngine(runner(calls), fontsDir).merge([scene], 5, finalPath, "9:16");

      const encode = calls.find((args) => args.includes("libx264"))!;
      expect(encode, JSON.stringify(scene)).toBeDefined();
      expect(encode.join(" ")).toContain("-crf 18 -preset slow");
      expect(encode.find((arg) => arg.startsWith("scale="))).toContain(":flags=lanczos");
    }
  });

  /**
   * The finished file is laid out so a player can start before it has all of it.
   *
   * On both writers that can produce it: the concat is the last step when there is no background music, and the
   * music mix rewrites the container afterwards when there is. Setting it only on the first would lose it on
   * every Episode that has music, which is the more common one.
   */
  it("puts the moov atom first in whichever step writes the final file", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16");
    expect(calls.find((args) => args.includes("concat"))!.join(" ")).toContain("-movflags +faststart");

    calls.length = 0;
    // The music mix probes the video first, so this runner answers that one call and records the rest.
    const probing = new FfmpegMergeEngine(async (arguments_) => {
      const args = [...arguments_]; calls.push(args);
      if (args[0] === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "5.0" } }), stderr: "" };
      await fs.writeFile(args.at(-1)!, Buffer.from("rendered"));
      return { stdout: "", stderr: "" };
    }, fontsDir);
    await probing.mixBackgroundMusic(finalPath, "bgm.mp3", 0.2, 1, path.join(path.dirname(finalPath), "mixed.mp4"));
    expect(calls.find((args) => args.includes("-filter_complex"))!.join(" ")).toContain("-movflags +faststart");
  });

  it("mixes in a real narration file with apad instead of anullsrc when one is given for a scene", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3" }], 5, finalPath, "9:16");
    const normalizeCall = calls.find((args) => args[0] === "ffmpeg" && args.includes("scene1_narration.mp3"))!;
    expect(normalizeCall).toBeDefined();
    expect(normalizeCall).toContain("scene1_narration.mp3");
    expect(normalizeCall).toContain("[1:a]apad[aout]");
    expect(normalizeCall).toContain("[aout]");
    expect(normalizeCall).not.toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(normalizeCall).toContain("-shortest");
  });

  it("mixes real narration and silent fallback independently per scene in a multi-scene merge", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    const scenes: MergeSceneInput[] = [{ clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3" }, { clip: "scene2.mp4" }];
    await engine.merge(scenes, 5, finalPath, "16:9");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(2);
    expect(normalizeCalls[0]).toContain("scene1_narration.mp3");
    expect(normalizeCalls[1]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });

  /**
   * The narration is audible in the merged file, and it does not cut the scene short.
   *
   * The two checks above read arguments — the file name is in the command, the filter says `[1:a]apad[aout]`,
   * silence uses `anullsrc`. All of that stays true if the finished file carries the clip's own silent track
   * instead: same command, wrong stream mapped out, and a voice somebody paid for is simply not in the reel.
   *
   * The duration is half the point. `-shortest` ends the output with whichever input runs out first, so a
   * two-second narration under a five-second scene would truncate the picture to two seconds — `apad` is what
   * stops that, and only the file can say whether it did.
   *
   * A silent clip and a tone make it unambiguous: anything above silence came from the narration, and the
   * counterpart run without one has to stay silent, or "audible" would mean nothing.
   */
  it("puts the narration into the file without shortening the scene to it", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "narration-real-")); roots.push(root);
    const clip = path.join(root, "scene1.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=5",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-shortest", "-c:v", "libx264", "-c:a", "aac", clip]);
    const narration = path.join(root, "scene1_narration.mp3");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", narration]);

    const meanVolume = async (file: string, extra: string[] = []): Promise<number> => {
      const { stderr } = await runMediaCommand(["ffmpeg", ...extra, "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
      return Number(/mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr)?.[1] ?? NaN);
    };
    const mergeInto = async (label: string, scene: MergeSceneInput): Promise<string> => {
      const finalPath = path.join(root, label, "instagram_reel.mp4");
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await new FfmpegMergeEngine().merge([scene], 5, finalPath, "9:16");
      return finalPath;
    };
    const durationOf = async (file: string): Promise<number> => {
      const { stdout } = await runMediaCommand(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", file]);
      return Number(JSON.parse(stdout).format.duration);
    };

    const spoken = await mergeInto("spoken", { clip, narrationAudioPath: narration });
    expect(await durationOf(spoken)).toBeGreaterThan(4.5); // the two-second voice did not truncate the scene
    expect(await meanVolume(spoken, ["-t", "1.5"])).toBeGreaterThan(-60); // the voice is in there
    expect(await meanVolume(spoken, ["-ss", "3", "-t", "2"])).toBeLessThan(-80); // and padded with silence after

    const silent = await mergeInto("silent", { clip });
    expect(await meanVolume(silent)).toBeLessThan(-80); // without a narration file, nothing is added
  }, 120000);

});

describe("FfmpegMergeEngine.merge subtitle burn-in", () => {
  /**
   * The normalized clips are a cache, and a failed merge is the one time they are not.
   *
   * Nothing reads them back and every merge rewrites them, so after a successful run they are a second
   * full-size copy of the finished video sitting in the person's own data folder — 12-13MB per Episode, on a
   * machine that also keeps every clip it has ever paid for. After a failed run they are the only record of
   * what the run actually produced: deleting them there would not cost something rebuildable, it would cost
   * the way to see why it broke.
   *
   * Asserted as a pair because either half alone is satisfied by doing nothing, or by always deleting.
   */
  /**
   * A photo card's scene is a picture, not footage.
   *
   * Measured before writing this: `ffprobe` calls a PNG `codec_type: "video"` and reports no `format.duration`,
   * so a still passes the stream check and fails the duration one. The probe is right — a still has no duration
   * of its own — so the duration is carried in and the caller skips the probe, rather than the probe being
   * loosened for every clip in the app.
   *
   * Paired with the clip test below it: an input shape that ignored `stillDurationSeconds` would still play a
   * real clip correctly, and one that looped everything would break every existing merge.
   */
  it("holds and slowly zooms a still, taking the duration it was given", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner(calls), fontsDir).merge([{ clip: "card.png", stillDurationSeconds: 5 }], 5, finalPath, "9:16");

    const normalize = calls.find((args) => args[0] === "ffmpeg" && args.includes("-vf"))!;
    // `-framerate 30` is part of the shape, not decoration: without it the image demuxer loops at its own 25 and
    // the frame counts the zoom is written in are counted in a rate nothing else in the chain uses.
    expect(normalize.slice(normalize.indexOf("-y") + 1, normalize.indexOf("-f"))).toEqual(["-loop", "1", "-framerate", "30", "-t", "5", "-i", "card.png"]);
    const filter = normalize[normalize.indexOf("-vf") + 1]!;
    expect(filter).toContain("zoompan=");
    // This line used to read `d=150` with the comment "five seconds at 30fps", which is the mistake itself
    // written down as if it were the rule: `d` is output frames **per input frame**, not a length. With the
    // still looped, 125 input frames each became 150 output ones and a five-second card came out 625 seconds
    // long. One in, one out; the loop decides the length.
    expect(filter).toContain(":d=1:");
    expect(filter).toContain("s=1080x1920");     // 9:16, the same size the shared filter pads to
  });

  it("still opens a real clip as one, with no loop and no zoom", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner(calls), fontsDir).merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16");

    const normalize = calls.find((args) => args[0] === "ffmpeg" && args.includes("-vf"))!;
    expect(normalize).not.toContain("-loop");
    expect(normalize[normalize.indexOf("-vf") + 1]).not.toContain("zoompan");
  });

  it("clears the normalized cache once the final file exists", async () => {
    const { root, finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner([]), fontsDir).merge([{ clip: "scene1.mp4" }, { clip: "scene2.mp4" }], 5, finalPath, "9:16");

    await expect(fs.stat(finalPath)).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, "videos", "final", "normalized"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the normalized cache when the merge failed, because that is what shows why", async () => {
    const { root, finalPath, fontsDir } = await setup();
    const failing: MediaCommandRunner = async (args) => {
      const list = [...args];
      if (list.includes("concat")) throw new MediaToolError("failed", "concat failed");
      await fs.writeFile(list.at(-1)!, Buffer.from("rendered"));
      return { stdout: "", stderr: "" };
    };

    // Asserted as the merge's own error, not merely "something threw": the first version of this test had no
    // MediaToolError import at all and passed on the ReferenceError that produced.
    await expect(new FfmpegMergeEngine(failing, fontsDir).merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16")).rejects.toBeInstanceOf(MediaToolError);

    await expect(fs.stat(path.join(root, "videos", "final", "normalized", "scene1.mp4"))).resolves.toBeTruthy();
    await expect(fs.stat(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a scene ASS file and appends the subtitles filter only for a scene with subtitle text", async () => {
    const calls: string[][] = [];
    const { root, finalPath, fontsDir } = await setup();
    const assFiles = new Map<string, string>();
    const engine = new FfmpegMergeEngine(runner(calls, assFiles), fontsDir);
    const scenes: MergeSceneInput[] = [
      { clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3", subtitleText: "첫 번째 문장입니다." },
      { clip: "scene2.mp4" },
    ];
    await engine.merge(scenes, 5, finalPath, "9:16");

    const ass = assFiles.get("scene1.ass")!;
    expect(ass).toContain("첫 번째 문장입니다.");
    expect(ass).toContain("PlayResX: 1080");

    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[1]!.find((arg) => arg.includes("subtitles="))).toBeUndefined();
    expect(assFiles.has("scene2.ass")).toBe(false);
  });

  it("passes the fonts directory to the subtitles filter's fontsdir option", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4", narrationAudioPath: "a.mp3", subtitleText: "문장" }], 5, finalPath, "9:16");
    const filterArg = calls.find((args) => args[0] === "ffmpeg" && args.includes("-vf"))!.find((arg) => arg.includes("subtitles="))!;
    expect(filterArg).toContain(`fontsdir='${escapeForFfmpegFilterPath(fontsDir)}'`);
  });
});

describe("FfmpegMergeEngine.mixBackgroundMusic", () => {
  function probeThenWriteRunner(durationSeconds: number, calls: string[][]): MediaCommandRunner {
    return async (arguments_) => {
      const args = [...arguments_]; calls.push(args);
      if (args[0] === "ffprobe") return { stdout: JSON.stringify({ format: { duration: String(durationSeconds) } }), stderr: "" };
      await fs.writeFile(args.at(-1)!, Buffer.from("mixed"));
      return { stdout: "", stderr: "" };
    };
  }

  it("loops the bgm input, trims it to the merged video's own duration, fades both ends, applies volume, and mixes without amix's own normalization", async () => {
    const calls: string[][] = [];
    const { root } = await setup();
    const inputPath = path.join(root, "instagram_reel.mp4");
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, Buffer.from("existing final"));
    const outputPath = path.join(root, "mixed.mp4");
    const engine = new FfmpegMergeEngine(probeThenWriteRunner(20, calls));

    await engine.mixBackgroundMusic(inputPath, "bgm.mp3", 0.4, 2, outputPath);

    const ffmpegCall = calls.find((args) => args[0] === "ffmpeg")!;
    expect(ffmpegCall).toContain("-stream_loop");
    expect(ffmpegCall[ffmpegCall.indexOf("-stream_loop") + 1]).toBe("-1");
    expect(ffmpegCall[ffmpegCall.indexOf("-stream_loop") + 2]).toBe("-i");
    expect(ffmpegCall[ffmpegCall.indexOf("-stream_loop") + 3]).toBe("bgm.mp3");
    const filter = ffmpegCall[ffmpegCall.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("atrim=0:20.000");
    expect(filter).toContain("afade=t=in:st=0:d=2.000");
    expect(filter).toContain("afade=t=out:st=18.000:d=2.000"); // fades out starting 2s before the 20s end
    expect(filter).toContain("volume=0.4");
    expect(filter).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0");
    expect(ffmpegCall).toContain("-c:v"); expect(ffmpegCall[ffmpegCall.indexOf("-c:v") + 1]).toBe("copy");
    await expect(fs.readFile(outputPath, "utf8")).resolves.toBe("mixed");
    await expect(fs.readFile(inputPath, "utf8")).resolves.toBe("existing final"); // never overwritten mid-command
  });

  it("clamps a fadeSeconds longer than half the video to avoid negative fade-out timing on a very short clip", async () => {
    const calls: string[][] = [];
    const { root } = await setup();
    const inputPath = path.join(root, "instagram_reel.mp4");
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, Buffer.from("existing final"));
    const engine = new FfmpegMergeEngine(probeThenWriteRunner(3, calls));

    await engine.mixBackgroundMusic(inputPath, "bgm.mp3", 0.25, 10, path.join(root, "mixed.mp4"));

    const filter = calls.find((args) => args[0] === "ffmpeg")![calls.find((args) => args[0] === "ffmpeg")!.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("afade=t=in:st=0:d=1.500"); // clamped to half of the 3s duration
    expect(filter).toContain("afade=t=out:st=1.500:d=1.500");
  });

  it("reports an unusable input the same way an invalid clip is reported elsewhere", async () => {
    const { root } = await setup();
    const engine = new FfmpegMergeEngine(async (arguments_) => {
      if (arguments_[0] === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "not-a-number" } }), stderr: "" };
      throw new Error("should not reach ffmpeg");
    });
    await expect(engine.mixBackgroundMusic(path.join(root, "in.mp4"), "bgm.mp3", 0.25, 2, path.join(root, "out.mp4")))
      .rejects.toMatchObject({ kind: "invalid" });
  });

  /**
   * The music has to be audible in the file, and the checks above only read the command.
   *
   * Every assertion in this describe block is about argument strings — `-stream_loop -1`, `atrim`, the two
   * `afade`s, `volume`, `amix`. All of them stay exactly true if the finished file ends up carrying the video's
   * own silent track instead of the mix: the filter is built, ffmpeg runs it, and the wrong stream is mapped
   * out. That is the shape D-042 was about, in the one place where being wrong is inaudible rather than visible.
   *
   * So this mixes a tone under a deliberately **silent** video and measures the result. Silence is what makes
   * the measurement unambiguous: anything above it can only have come from the music.
   *
   * Three properties, each of which an argument can promise and a file can fail to have:
   *   - the music is in there at all;
   *   - a three-second track still plays at nine seconds, which is what `-stream_loop -1` is for;
   *   - the first fifth of a second is far quieter than the body, which is the fade-in.
   */
  it("puts audible music into the file, looping it and fading it in", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bgm-real-")); roots.push(root);
    const video = path.join(root, "reel.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=10",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-shortest", "-c:v", "libx264", "-c:a", "aac", video]);
    const bgm = path.join(root, "bgm.mp3");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", bgm]);

    const meanVolume = async (file: string, extra: string[] = []): Promise<number> => {
      const { stderr } = await runMediaCommand(["ffmpeg", ...extra, "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
      return Number(/mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr)?.[1] ?? NaN);
    };

    const mixed = path.join(root, "mixed.mp4");
    await new FfmpegMergeEngine().mixBackgroundMusic(video, bgm, 0.4, 2, mixed);

    const silence = await meanVolume(video);
    expect(silence).toBeLessThan(-80); // the input really is silent, so the rest means something

    const body = await meanVolume(mixed);
    expect(body).toBeGreaterThan(-60); // the music is in the file

    // Nine seconds into a ten-second video, from a three-second track: only looping puts sound here.
    const late = await meanVolume(mixed, ["-ss", "8", "-t", "1.5"]);
    expect(late).toBeGreaterThan(-60);

    const opening = await meanVolume(mixed, ["-t", "0.2"]);
    expect(opening).toBeLessThan(body - 10); // fading in, not starting at full level
  }, 120000);

});

describe("FfmpegMergeEngine.merge holds a still for the time it was asked for", () => {
  /**
   * `zoompan`'s `d` is output frames **per input frame**, and the still arrives looped — so `d = seconds * 30`
   * multiplied instead of setting a length.
   *
   * Measured end to end on a real photo card before the fix: a five-second card came out **625 seconds long and
   * 79 MB**, and took nine and a half minutes to encode. 125 looped input frames, each turned into 150 output
   * ones. Nothing failed; the merge reported success and wrote a file nobody could use.
   *
   * This pair pins the two halves of the mistake in the arguments, and the pair below measures the thing that
   * actually matters — the length — with a real FFmpeg.
   */
  it("gives zoompan one output frame per input frame and loops at the output rate", async () => {
    const calls: string[][] = [];
    const runner: MediaCommandRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "5" } }), stderr: "" };
      const target = args[args.length - 1]!;
      if (target.endsWith(".mp4")) await fs.writeFile(target, "video");
      return { stdout: "", stderr: "" };
    };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kenburns-args-")); roots.push(root);
    const finalPath = path.join(root, "final", "instagram_reel.mp4");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    await new FfmpegMergeEngine(runner).merge([{ clip: "card.png", stillDurationSeconds: 5 }], 5, finalPath, "9:16");

    const encode = calls.find((args) => args.includes("-loop"))!;
    expect(encode).toBeDefined();
    // The loop has to run at the rate the output keeps, or the frame counts below are counted in a rate nothing
    // else in the chain uses.
    expect(encode.join(" ")).toContain("-loop 1 -framerate 30 -t 5");
    const filter = encode[encode.indexOf("-vf") + 1]!;
    expect(filter).toContain("zoompan=");
    expect(filter).toContain(":d=1:"); // one in, one out — the loop decides the length
    expect(filter).not.toMatch(/:d=(?!1:)\d+/); // never a frame count, which is what multiplied
    // The zoom is driven by elapsed output frames, because with d=1 there is no previous frame to add to.
    expect(filter).toContain("on/150");
  });

  /**
   * The property the arguments above exist for, measured rather than described.
   *
   * Skipped where FFmpeg is not installed — the app already treats that as a normal state
   * (MediaToolError "unavailable"), and a test that cannot run is better skipped out loud than quietly turned
   * into an assertion about argument strings, which is what the fake-runner pair above already is.
   */
  it("produces a video as long as the hold, not a multiple of it", async ({ skip }) => {
    const probe = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!probe) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kenburns-real-")); roots.push(root);
    const still = path.join(root, "card.png");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=teal:s=1080x1920", "-frames:v", "1", still]);
    const finalPath = path.join(root, "final", "instagram_reel.mp4");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    await new FfmpegMergeEngine().merge([{ clip: still, stillDurationSeconds: 5 }], 5, finalPath, "9:16");

    const { stdout } = await runMediaCommand(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", finalPath]);
    const duration = Number(JSON.parse(stdout).format.duration);
    expect(duration).toBeGreaterThan(4.5);
    expect(duration).toBeLessThan(6); // 625 seconds is what this looked like before
  }, 60000);

  /**
   * The quote is the whole point of a photo card, and nothing measured that it reaches the picture.
   *
   * Every other check here reads the arguments — that the chain contains `subtitles=`, that the .ass says what
   * it should. All of that stays true if the font directory moves, if the path escaping breaks on a platform,
   * if libass is missing: FFmpeg draws nothing, exits 0, and the merge reports success. That is D-042's lesson
   * again — a test that reads arguments can only say "the code writes this today".
   *
   * So this renders the same still twice, once with the quote and once without, and compares a frame from each.
   * Identical frames mean the quote drew nothing.
   */
  it("burns the quote into the picture, in a script a person can read", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "burnin-")); roots.push(root);
    const still = path.join(root, "card.png");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=#204060:s=1080x1920", "-frames:v", "1", still]);

    async function frameOf(label: string, subtitleText?: string): Promise<string> {
      const finalPath = path.join(root, label, "instagram_reel.mp4");
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await new FfmpegMergeEngine().merge(
        [{ clip: still, stillDurationSeconds: 5, ...(subtitleText === undefined ? {} : { subtitleText }) }],
        5, finalPath, "9:16",
      );
      const frame = path.join(root, `${label}.png`);
      await runMediaCommand(["ffmpeg", "-y", "-ss", "2.5", "-i", finalPath, "-frames:v", "1", frame]);
      return frame;
    }

    // Korean on purpose: a font without Hangul draws boxes, and boxes are still "different from blank" — but a
    // font that cannot open at all draws nothing, which is what this catches.
    const withQuote = await frameOf("withquote", "천천히, 그러나 멈추지 않고");
    const plain = await frameOf("plain");

    const { stderr } = await runMediaCommand(["ffmpeg", "-i", withQuote, "-i", plain, "-filter_complex", "ssim", "-f", "null", "-"]);
    const similarity = Number(/All:([0-9.]+)/.exec(stderr)?.[1] ?? "1");
    expect(similarity).toBeLessThan(0.999);

    // And it goes where a photo card's text now goes, which is not where it used to. Measured by cropping: the
    // band around 0.40 of the height is many times the size of the same band without the quote, and the bottom
    // band — where this used to draw, under the Reels caption and buttons — is left as empty as a blank frame.
    //
    // This pair asserted the opposite until the card got its own layout, and passing then was the defect: the
    // text was rendered exactly where the platform covers it (Cowork Round 434, 캡틴D: "자막이 너무 아래다").
    const band = async (frame: string, y: number) => {
      const target = path.join(root, `${path.basename(frame, ".png")}-${y}.png`);
      await runMediaCommand(["ffmpeg", "-y", "-i", frame, "-vf", `crop=1080:260:0:${y}`, target]);
      return (await fs.stat(target)).size;
    };
    expect(await band(withQuote, 640)).toBeGreaterThan(await band(plain, 640) * 3);
    expect(await band(withQuote, 1660)).toBeLessThan(await band(plain, 1660) * 3);
  }, 120000);


  /**
   * The orientation, measured on the file rather than on the argument that carries it.
   *
   * The pair above pins where the card's choice is stored, through the helper every renderer reads. This one
   * closes the other end: that the merge actually produces a landscape file. Between the two there is nowhere
   * for "the value is right but the video is portrait" to hide, which is exactly the state this was found in.
   */
  it("renders a landscape card landscape and a portrait card portrait", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ratio-real-")); roots.push(root);
    const still = path.join(root, "card.png");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=#204060:s=1024x1536", "-frames:v", "1", still]);

    const sizeOf = async (ratio: string): Promise<string> => {
      const finalPath = path.join(root, ratio.replace(":", "x"), "instagram_reel.mp4");
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await new FfmpegMergeEngine().merge([{ clip: still, stillDurationSeconds: 5 }], 5, finalPath, ratio);
      const { stdout } = await runMediaCommand(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", finalPath]);
      return stdout.trim().split("\n")[0]!.replace(/,+$/, "");
    };

    expect(await sizeOf("16:9")).toBe("1920x1080");
    expect(await sizeOf("9:16")).toBe("1080x1920");
    // Item 6: square either way a caller names it — the short side passes Runway's ratio, the long side the shape.
    expect(await sizeOf("1:1")).toBe("1080x1080");
    expect(await sizeOf("960:960")).toBe("1080x1080");
    expect(await sizeOf("4:5")).toBe("1080x1350");
    expect(await sizeOf("832:1104")).toBe("1080x1350");
  }, 120000);

  /**
   * The quarter turn, measured on the file: its size, and which way it went.
   *
   * A landscape clip whose top half is red and bottom half blue. Turned clockwise, its top lands on the right — so
   * the right of the finished portrait frame is red and the left blue. Turned the other way, the two swap, and
   * the size alone could not tell them apart.
   */
  it("turns a landscape reel clockwise into a portrait file", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rotate-real-")); roots.push(root);
    const clip = path.join(root, "scene1.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=1",
      "-vf", "drawbox=x=0:y=90:w=320:h=90:color=blue:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    const finalPath = path.join(root, "final", "instagram_reel.mp4");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await new FfmpegMergeEngine().merge([{ clip }], 1, finalPath, "16:9", { rotateClockwise: true });

    const { stdout } = await runMediaCommand(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", finalPath]);
    expect(stdout.trim().replace(/,+$/, "")).toBe("1080x1920");

    const pixelAt = async (x: number): Promise<[number, number, number]> => {
      const raw = path.join(root, `pixel-${x}.raw`);
      await runMediaCommand(["ffmpeg", "-y", "-ss", "0.5", "-i", finalPath, "-frames:v", "1",
        "-vf", `crop=8:8:${x}:956,scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
      const bytes = await fs.readFile(raw);
      return [bytes[0]!, bytes[1]!, bytes[2]!];
    };
    const [leftRed, , leftBlue] = await pixelAt(200);
    const [rightRed, , rightBlue] = await pixelAt(872);
    expect(rightRed, "the clip's top is on the right").toBeGreaterThan(rightBlue);
    expect(leftBlue, "and its bottom on the left").toBeGreaterThan(leftRed);
  }, 120000);

  /**
   * card-palette.ts, end to end: the text colour is chosen from the real picture, through the real sample. A dark
   * picture gets pale text and a bright one dark text — the fixed white every card had would fail the second.
   */
  it("colours a card's text from its picture: pale on a dark one, dark on a bright one", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "card-colour-real-")); roots.push(root);

    const bodyColourOn = async (name: string, colour: string): Promise<{ r: number; g: number; b: number }> => {
      const still = path.join(root, `${name}.png`);
      await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=1024x1536`, "-frames:v", "1", still]);
      const finalPath = path.join(root, name, "instagram_reel.mp4");
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      const ass = new Map<string, string>();
      const capturing: MediaCommandRunner = async (args) => { await captureAss(args.at(-1)!, ass); return runMediaCommand(args); };
      await new FfmpegMergeEngine(capturing).merge([{ clip: still, stillDurationSeconds: 1, subtitleText: "첫 줄\n둘째 줄" }], 1, finalPath, "9:16");
      const body = /Style: Body,[^,]+,\d+,&H00([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2}),/.exec(ass.get("scene1.ass") ?? "");
      expect(body, `${name}: a Body style with an opaque colour`).not.toBeNull();
      return { r: parseInt(body![3]!, 16), g: parseInt(body![2]!, 16), b: parseInt(body![1]!, 16) };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    expect(luminance(await bodyColourOn("navy", "#142864")), "pale text on navy").toBeGreaterThan(0.8);
    expect(luminance(await bodyColourOn("lemon", "#FAD73C")), "dark text on lemon").toBeLessThan(0.2);
  }, 120000);

  /** RotateFinalVideoResponse: a finished landscape file turned in place — same size and direction, sound kept. */
  it("turns a finished landscape file clockwise in place and keeps its sound", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rotate-final-real-")); roots.push(root);
    const file = path.join(root, "instagram_reel.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=1920x1080:d=1", "-f", "lavfi", "-i", "sine=frequency=330:duration=1:sample_rate=48000",
      "-vf", "drawbox=x=0:y=540:w=1920:h=540:color=blue:t=fill", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);

    await new FfmpegMergeEngine().rotateClockwise(file);

    expect(await probeClipFacts(file)).toEqual({ width: 1080, height: 1920, hasAudio: true });
    const pixelAt = async (x: number): Promise<[number, number, number]> => {
      const raw = path.join(root, `pixel-${x}.raw`);
      await runMediaCommand(["ffmpeg", "-y", "-ss", "0.5", "-i", file, "-frames:v", "1", "-vf", `crop=8:8:${x}:956,scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
      const bytes = await fs.readFile(raw);
      return [bytes[0]!, bytes[1]!, bytes[2]!];
    };
    const [rightRed, , rightBlue] = await pixelAt(872);
    expect(rightRed, "the top is on the right").toBeGreaterThan(rightBlue);
    await expect(fs.readdir(root)).resolves.not.toContainEqual(expect.stringContaining(".tmp"));
  }, 120000);


  /**
   * The scenes come out in the order they went in, measured on the file.
   *
   * Order is the property that survives every argument check in this file: the concat list is built, ffmpeg is
   * called, the durations add up, and a reversed or shuffled reel is byte-for-byte as plausible. A person would
   * find out by watching their own episode.
   *
   * Six one-second clips in six colours far apart, merged, then one pixel read out of the middle of each second.
   * Colour is used rather than image similarity because two flat frames can score high on structural similarity
   * while being different colours — the thing being measured has to be the thing that differs.
   *
   * Measured on the real thing first: a real Episode's six clips merged to 30.22s and each five-second window
   * matched its own scene (0.72-0.995 against ~0.10 for every other pairing).
   */
  it("concatenates the scenes in order", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "order-real-")); roots.push(root);
    const colours = [
      { name: "red", rgb: [255, 0, 0] },
      { name: "green", rgb: [0, 255, 0] },
      { name: "blue", rgb: [0, 0, 255] },
      { name: "yellow", rgb: [255, 255, 0] },
      { name: "magenta", rgb: [255, 0, 255] },
      { name: "cyan", rgb: [0, 255, 255] },
    ];
    const clips: string[] = [];
    for (const [index, colour] of colours.entries()) {
      const clip = path.join(root, `scene${index + 1}.mp4`);
      await runMediaCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", `color=c=${colour.name}:s=320x568:d=1`,
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-shortest", "-c:v", "libx264", "-c:a", "aac", clip]);
      clips.push(clip);
    }

    const finalPath = path.join(root, "final", "instagram_reel.mp4");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await new FfmpegMergeEngine().merge(clips.map((clip) => ({ clip })), 5, finalPath, "9:16");

    /** The colour at the centre of the frame at `at` seconds, as three bytes. */
    const pixelAt = async (at: number): Promise<[number, number, number]> => {
      const raw = path.join(root, `pixel-${at}.raw`);
      await runMediaCommand(["ffmpeg", "-y", "-ss", String(at), "-i", finalPath, "-frames:v", "1",
        "-vf", "crop=8:8:(iw-8)/2:(ih-8)/2,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
      const bytes = await fs.readFile(raw);
      return [bytes[0]!, bytes[1]!, bytes[2]!];
    };
    const nearest = (pixel: readonly number[]): number => {
      const distances = colours.map(({ rgb }) => rgb.reduce((sum, value, index) => sum + (value - pixel[index]!) ** 2, 0));
      return distances.indexOf(Math.min(...distances));
    };

    const seen: number[] = [];
    for (let index = 0; index < colours.length; index += 1) seen.push(nearest(await pixelAt(index + 0.5)) + 1);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  }, 180000);

});

/**
 * A news reel scene brings its whole overlay with it — two bands and four lines — so the merge draws that
 * instead of the photo card's subtitle. The branch is worth a pair of its own because both paths write a file
 * called `scene1.ass` into the same place: a merge that took the wrong one would produce a video that looks
 * finished and is missing its bands (docs/06_DECISIONS.md D-052).
 */
describe("a scene carrying a news reel card", () => {
  const CARD = {
    publisher: "연합뉴스",
    headline: { line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" },
    caption: { line1: "9월 17일 국회 본회의", line2: null },
    creditRequired: false,
  } as const;

  it("draws the card's own overlay, bands and all", async () => {
    const ass = new Map<string, string>();
    const { finalPath, fontsDir } = await setup();

    await new FfmpegMergeEngine(runner([], ass), fontsDir)
      .merge([{ clip: "card.png", stillDurationSeconds: 5, newsReelCard: CARD }], 5, finalPath, "9:16");

    const written = [...ass.values()].join("\n");
    expect(written, "언론사 띠가 그려집니다").toContain("Style: Band,");
    expect(written, "노란 줄이 자기 색을 씁니다").toContain("Style: HeadlineAccent,");
    expect(written).toContain("후속 법률 51건 통과");
  });

  /**
   * 🔴 포토카드의 글은 **한 글자도 안 섞여야** 합니다. 섞이면 카드의 자막 띠 **밑에** 같은 말이 한 번 더
   * 구워지고, 그건 화면에서야 보입니다.
   */
  it("does not also draw the photo card's subtitle over it", async () => {
    const ass = new Map<string, string>();
    const { finalPath, fontsDir } = await setup();

    await new FfmpegMergeEngine(runner([], ass), fontsDir)
      .merge([{ clip: "card.png", stillDurationSeconds: 5, subtitleText: "여기 있으면 안 됩니다", newsReelCard: CARD }], 5, finalPath, "9:16");

    const written = [...ass.values()].join("\n");
    expect(written).not.toContain("여기 있으면 안 됩니다");
    expect(written, "포토카드의 본문 스타일은 안 나옵니다").not.toContain("Style: Body,");
  });

  /** 🟠 카드가 없는 장면은 하나도 안 바뀝니다 — 이 갈림길이 기존 포토카드를 건드리지 않았다는 반쪽입니다. */
  it("leaves an ordinary photo card exactly as it was", async () => {
    const ass = new Map<string, string>();
    const { finalPath, fontsDir } = await setup();

    await new FfmpegMergeEngine(runner([], ass), fontsDir)
      .merge([{ clip: "card.png", stillDurationSeconds: 5, subtitleText: "오늘의 문장" }], 5, finalPath, "9:16");

    const written = [...ass.values()].join("\n");
    expect(written).toContain("오늘의 문장");
    expect(written).not.toContain("Style: Band,");
  });
});
