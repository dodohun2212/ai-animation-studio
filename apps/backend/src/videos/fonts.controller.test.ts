import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { FontsController } from "./fonts.controller.js";

/** Just enough of Express's response for this controller: what it typed, and what it sent. */
function recorder() {
  const state: { type?: string; body?: Buffer } = {};
  return { state, response: { type: (value: string) => { state.type = value; }, send: (body: Buffer) => { state.body = body; } } };
}

describe("serving the subtitle fonts", () => {
  /**
   * The preview drew with a font the browser did not have.
   *
   * `font-family: "Noto Serif KR"` in the card preview matched nothing on Captain D's machine, so it fell back
   * to a generic serif and `font-weight: 700` changed nothing — measured as three weights all reporting the
   * same glyph width. The difference only showed up in the finished video. These bytes are the ones FFmpeg is
   * pointed at, so a preview that loads them is drawing the video's own face.
   */
  it("hands over a font this app actually ships", async () => {
    const { state, response } = recorder();

    await new FontsController().font("NotoSerifKR-Bold.ttf", response as never);

    const onDisk = await fs.readFile(path.resolve(import.meta.dirname, "../../../../fonts/NotoSerifKR-Bold.ttf"));
    // Digested rather than compared element by element: these are fourteen megabytes, and a deep-equality
    // check on that runs for half a minute while proving exactly the same thing.
    const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    expect(state.body?.length).toBe(onDisk.length);
    expect(digest(state.body!), "the same bytes, not a copy that can drift").toBe(digest(onDisk));
    expect(state.type).toBe("font/ttf");
  });

  /**
   * The name is matched against the directory listing, never joined onto a path.
   *
   * A traversal has nothing to work with when the only accepted values are the entries that are really there,
   * and this route is reachable from a browser.
   */
  it("refuses anything that is not one of those files, by name", async () => {
    const controller = new FontsController();
    for (const name of ["../../../package.json", "..\..\secrets.env", "OFL.txt", "NotoSerifKR-Bold.ttf.bak", ""]) {
      await expect(controller.font(name, recorder().response as never), name || "(empty)").rejects.toThrow();
    }
  });

  /** The route the client builds and the route the controller answers are one string. */
  it("answers the contract's own route", () => {
    expect(API_ROUTES.subtitleFont("NotoSansKR-Medium.ttf")).toBe("/fonts/NotoSansKR-Medium.ttf");
  });
});
