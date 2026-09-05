import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Controller, Get, Header, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { fontsRoot } from "./ffmpeg-merge.service.js";

/**
 * The subtitle fonts, over HTTP, so a preview can draw with the bytes the video is made from.
 *
 * The card preview styled its text with `font-family: "Noto Serif KR"` and the browser had never heard of it —
 * Captain D's machine has no such font, so the preview fell back to a generic serif and `font-weight: 700` did
 * nothing at all. Measured by Cowork (Round 556): three different weights all reported the same glyph width,
 * which is what a fallback looks like. So the preview promised a face the render would not use, and the
 * difference only became visible in the finished video.
 *
 * Served from `fontsRoot()` rather than copied into the frontend's `public/`: 20MB of the same bytes in two
 * places is how the two come apart later, and this folder is already the one FFmpeg is pointed at.
 *
 * Only files that are actually in that directory, by exact name, and only `.ttf`. The name never becomes a
 * path — it is matched against the directory listing — so there is nothing here for `..` to do.
 */
@Controller()
export class FontsController {
  @Get(API_ROUTES.subtitleFont(":name"))
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async font(@Param("name") name: string, @Res() response: Response): Promise<void> {
    const directory = fontsRoot();
    const available = await fs.readdir(directory).catch(() => [] as string[]);
    const match = available.find((entry) => entry === name && entry.toLowerCase().endsWith(".ttf"));
    if (!match) throw new NotFoundException({ code: "FONT_NOT_FOUND", message: "요청한 자막 글꼴 파일이 없습니다." });
    response.type("font/ttf");
    response.send(await fs.readFile(path.join(directory, match)));
  }
}
