import { describe, expect, it } from "vitest";

import { createStoredProject } from "./project.mapper.js";
import { applyShortProjectSettings, toShortProjectSettings } from "./project-settings.js";
import { imageSizeForAspect, runwayRatioForAspect, shortProjectAspectRatio } from "./project-aspect.js";
import type { StoredProject } from "./project-storage.schema.js";

/**
 * Saves settings the way the settings screen does, so what these tests read is what a save actually leaves on
 * disk. That round trip is the point: the bug this file exists for was not in either half. Saving wrote the
 * choice correctly and every reader read a real field correctly — they were simply different fields, and no test
 * ever put the two halves together.
 */
function projectWithAspect(aspect: string | undefined): StoredProject {
  const stored = createStoredProject("p1", "topic", "2026-08-27T00:00:00.000Z");
  const settings = toShortProjectSettings(stored);
  return applyShortProjectSettings(
    stored,
    { ...settings, styleNotes: aspect === undefined ? {} : { aspect } },
    "2026-08-27T00:00:00.000Z",
  );
}

describe("shortProjectAspectRatio", () => {
  it("returns the landscape the settings screen saved", () => {
    // The reported bug: 가로형 chosen, portrait produced. Every scene image, the Runway ratio and the merge
    // canvas all followed this one value, so getting it wrong cost real money three times over.
    expect(shortProjectAspectRatio(projectWithAspect("16:9"))).toBe("16:9");
  });

  it("returns portrait for the portrait choice", () => {
    expect(shortProjectAspectRatio(projectWithAspect("9:16"))).toBe("9:16");
  });

  it("falls back to portrait when the project never recorded a choice", () => {
    expect(shortProjectAspectRatio(projectWithAspect(undefined))).toBe("9:16");
  });

  it("reads a value stored with stray spaces", () => {
    expect(shortProjectAspectRatio(projectWithAspect("16 : 9"))).toBe("16:9");
  });

  it("treats an unrecognisable value as portrait rather than guessing", () => {
    expect(shortProjectAspectRatio(projectWithAspect("widescreen"))).toBe("9:16");
  });

  it("ignores style_profile.aspect, which nothing writes and which used to be the only thing read", () => {
    // Pinned so the old field cannot quietly come back as a second source of truth. A project carrying both
    // must follow the one the settings screen actually saves.
    const stored = projectWithAspect("16:9");
    const withLegacyField: StoredProject = { ...stored, style_profile: { ...stored.style_profile, aspect: "9:16" } };
    expect(shortProjectAspectRatio(withLegacyField)).toBe("16:9");
  });
});

describe("provider vocabularies", () => {
  it("gives OpenAI and Runway the same orientation in their own terms", () => {
    const landscape = projectWithAspect("16:9");
    expect(imageSizeForAspect(landscape)).toBe("1536x1024");
    expect(runwayRatioForAspect(landscape)).toBe("1280:720");

    const portrait = projectWithAspect("9:16");
    expect(imageSizeForAspect(portrait)).toBe("1024x1536");
    expect(runwayRatioForAspect(portrait)).toBe("720:1280");
  });

  it("never disagrees with the ratio it derives from", () => {
    // The image is generated first and the video is billed against it. A pair that disagreed would produce a
    // paid-for image in one shape and a paid-for video in another, which is how this surfaced originally.
    for (const aspect of ["16:9", "9:16", "nonsense", undefined]) {
      const project = projectWithAspect(aspect);
      const landscape = shortProjectAspectRatio(project) === "16:9";
      expect(imageSizeForAspect(project)).toBe(landscape ? "1536x1024" : "1024x1536");
      expect(runwayRatioForAspect(project)).toBe(landscape ? "1280:720" : "720:1280");
    }
  });
});
