import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { newsReelCardGeometry, type NewsReelCard } from "@ai-animation-studio/shared";
import { afterAll, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { NewsReelService } from "../projects/news-reel.service.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalVideoMergeService } from "./video-merge.service.js";

/**
 * One reel, made and burned the way the app makes one — and then looked at.
 *
 * Everything else about this feature is now paired: the contract counts characters, the prompt asks for four
 * lines, the overlay draws bands, the route writes a project. None of that answers the only question 캡틴D
 * asks, which is whether a reel comes out. The first time this feature ran end to end the answer was
 * 「존나 별로야」 (Round 1017), and it was found by watching a video rather than by a green suite.
 *
 * So this walks the whole path with no provider, no key and no money: a picture into the Library, the create
 * route, the real merge with real ffmpeg, and then the finished file is measured. The pair that mattered most
 * was found exactly here — the merge wrote no subtitle file at all for a reel, and every unit test was green.
 */
const CARD: NewsReelCard = {
  publisher: "연합뉴스",
  headline: { line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" },
  caption: { line1: "9월 17일 국회 본회의", line2: null },
  creditRequired: false,
};

const roots: string[] = [];
afterAll(async () => { for (const root of roots) await fs.rm(root, { recursive: true, force: true }); });

/** A grey still big enough to be a real background, drawn by ffmpeg rather than checked in. */
function greyPicture(file: string): void {
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x6E6E6E:s=1080x1920:d=1", "-frames:v", "1", file], { stdio: "pipe" });
}

function probe(file: string, entries: string): string {
  return execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=nw=1:nk=1", file]).toString().trim();
}

/** How many pixels of one row are near a colour — the same instrument the overlay's own render pair uses. */
function countNear(frame: string, y: number, want: { r: number; g: number; b: number }, tolerance = 40): number {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", frame, "-vf", `crop=1080:1:0:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 22 });
  let found = 0;
  for (let index = 0; index + 2 < raw.length; index += 3) {
    if (Math.abs(raw[index]! - want.r) <= tolerance && Math.abs(raw[index + 1]! - want.g) <= tolerance && Math.abs(raw[index + 2]! - want.b) <= tolerance) found += 1;
  }
  return found;
}

describe("a news reel, made and burned", () => {
  it("comes out 1080x1920 with its bands and both headline colours on it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-reel-e2e-"));
    roots.push(root);
    const projectsRoot = path.join(root, "projects");
    const projects = new LocalProjectRepository(projectsRoot);
    const assets = new LocalAssetsRepository(root);

    const picture = path.join(root, "topic.png");
    greyPicture(picture);
    const asset = await assets.create(
      { buffer: await fs.readFile(picture), originalname: "topic.png", mimetype: "image/png" },
      { assetType: "general_reference", displayName: "정치" },
    );

    await new NewsReelService(projects, assets, projectsRoot, { warn: () => {} }).create({
      projectId: "news_reel_e2e",
      assetIds: [asset.asset_id],
      card: CARD,
      clipDurationSeconds: 5,
      aspectRatio: "9:16",
    });

    // No runner: the real ffmpeg, the real fonts, the path the app takes.
    const merged = await new LocalVideoMergeService(projects, projectsRoot).merge("news_reel_e2e");
    const finalFile = path.join(projects.projectDirectory("news_reel_e2e"), merged.finalVideoPath);

    expect(probe(finalFile, "stream=width,height").split(/\r?\n/)).toEqual(["1080", "1920"]);

    const frame = path.join(root, "frame.png");
    // A second in, well past the first frame: what is being asked is what somebody watching sees.
    execFileSync("ffmpeg", ["-y", "-ss", "1", "-i", finalFile, "-frames:v", "1", frame], { stdio: "pipe" });

    const g = newsReelCardGeometry(1080, 1920, 1);
    expect(countNear(frame, Math.round(g.bandHeight / 2), { r: 11, g: 30, b: 58 }), "위 띠가 있습니다").toBeGreaterThan(900);
    expect(countNear(frame, g.headline2Y, { r: 255, g: 212, b: 0 }), "둘째 줄이 노랗습니다").toBeGreaterThan(100);
    expect(countNear(frame, g.headline1Y, { r: 255, g: 255, b: 255 }, 12), "첫 줄이 흽니다").toBeGreaterThan(100);
    expect(countNear(frame, g.caption1Y, { r: 255, g: 255, b: 255 }, 12), "자막이 있습니다").toBeGreaterThan(60);
  }, 120_000);
});
