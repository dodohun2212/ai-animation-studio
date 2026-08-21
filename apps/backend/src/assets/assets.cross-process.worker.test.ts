import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "./assets.repository.js";

const root = process.env.ASSET_CROSS_PROCESS_ROOT;
const variant = process.env.ASSET_CROSS_PROCESS_VARIANT ?? "same";

describe.runIf(Boolean(root))("cross-process Asset writer", () => {
  it("writes one Asset transaction from an independent Node process", async () => {
    const images = {
      first: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=",
      second: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      same: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=",
    } as const;
    const image = Buffer.from(images[variant as keyof typeof images] ?? images.same, "base64");
    const asset = await new LocalAssetsRepository(path.resolve(root!)).create(
      { buffer: image, originalname: `동시_${variant}.png`, mimetype: "application/octet-stream" },
      { assetType: "background", displayName: `동시 저장 ${variant}` },
    );
    expect(asset.asset_id).toMatch(/^ASSET-BG-/);
  });
});
