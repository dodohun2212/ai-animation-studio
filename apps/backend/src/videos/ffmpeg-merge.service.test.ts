import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegMergeEngine, MediaToolError, runMediaCommand, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
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

describe("FfmpegMergeEngine.merge narration audio mixing", () => {
  it("uses anullsrc silence when a scene has no narration file, unchanged from before narration existed", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16");
    const normalizeCall = calls.find((args) => args.includes("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"))!;
    expect(normalizeCall).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(normalizeCall).not.toContain("apad");
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

    // And it goes where a subtitle goes. Measured by cropping: with the quote, the bottom band is many times
    // the size of the same band without it, while the middle band is unchanged — which is also how I found out
    // that a second line I thought I saw in the middle of a frame was not there.
    const band = async (frame: string, y: number) => {
      const target = path.join(root, `${path.basename(frame, ".png")}-${y}.png`);
      await runMediaCommand(["ffmpeg", "-y", "-i", frame, "-vf", `crop=1080:260:0:${y}`, target]);
      return (await fs.stat(target)).size;
    };
    expect(await band(withQuote, 1660)).toBeGreaterThan(await band(plain, 1660) * 3);
    expect(await band(withQuote, 580)).toBeLessThan(await band(plain, 580) * 3);
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

    const sizeOf = async (ratio: "9:16" | "16:9"): Promise<string> => {
      const finalPath = path.join(root, ratio.replace(":", "x"), "instagram_reel.mp4");
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await new FfmpegMergeEngine().merge([{ clip: still, stillDurationSeconds: 5 }], 5, finalPath, ratio);
      const { stdout } = await runMediaCommand(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", finalPath]);
      return stdout.trim().split("\n")[0]!.replace(/,+$/, "");
    };

    expect(await sizeOf("16:9")).toBe("1920x1080");
    expect(await sizeOf("9:16")).toBe("1080x1920");
  }, 120000);

});
