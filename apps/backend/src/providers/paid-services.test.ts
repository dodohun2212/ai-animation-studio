import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Which services can spend money, pinned.
 *
 * Twice now a screen has told someone a step was free while the service behind it called a provider and
 * recorded a charge. Both times the sentence had been true when it was written, both times the service later
 * gained a budget, and both times nothing connected the two — the screen went on saying it, the comment
 * justifying it went stale in the same breath, and the test pinned the wording rather than the fact, so every
 * run stayed green precisely because the claim was intact.
 *
 * A screen cannot check this for itself: nothing on the frontend can see a constructor here. Nor can this test
 * check the screens — plenty of them say a step is free about steps that really are, so the words alone decide
 * nothing. What it can do is make the moment of breakage loud. A service gaining a budget is the single change
 * that caused both bugs, and it is otherwise silent.
 *
 * So this list is not documentation. It is a tripwire at exactly that moment, and its failure message is the
 * question nobody was asked: which screens offer this step, and do they still tell the truth about it?
 */

/**
 * Declaring one of the budget types is what "this service can spend money" means here.
 *
 * Anchored on the colon of a type position, so importing the type or naming its error class does not count —
 * several services import OpenAiBudgetExceededError to catch it and cannot themselves charge anything.
 *
 * The optional `import(...)` prefix is not hypothetical tidiness: the first draft required the type to be named
 * directly, and a deliberately planted `import("...").OpenAiBudget` walked straight past it. A guard that only
 * recognises the spelling its author happened to think of is the thing it exists to catch.
 */
const BUDGET_DECLARATION = /:\s*(?:import\([^)]*\)\.)?(OpenAiBudget|RunwayBudget)\b/;

const PAID_SERVICES = [
  "images/image-review.service.ts",
  "images/local-image-generation.service.ts",
  "long-projects/episode-images.service.ts",
  "long-projects/episode-narration.service.ts",
  "long-projects/episode-scripts.service.ts",
  "long-projects/episode-videos.service.ts",
  "long-projects/long-projects.service.ts",
  "narration/local-narration-generation.service.ts",
  "narration/narration-review.service.ts",
  "story/story-prompt.service.ts",
  "videos/local-video-submission.service.ts",
  "videos/local-video-workflow.service.ts",
  "videos/video-library.service.ts",
  "videos/video-preview.service.ts",
];

/** Resolved from this file, not the working directory — vitest runs with the workspace as cwd and the repo root elsewhere. */
const backendSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function servicesTakingABudget(): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.name.endsWith(".service.ts") || entry.name.endsWith(".test.ts")) continue;
      if (BUDGET_DECLARATION.test(await fs.readFile(full, "utf8"))) {
        found.push(path.relative(backendSource, full).replaceAll(path.sep, "/"));
      }
    }
  };
  await walk(backendSource);
  return found.sort();
}

describe("services that can spend money", () => {
  it("are only the ones already accounted for", async () => {
    const actual = await servicesTakingABudget();

    // If this fails, read the diff before editing the list.
    //
    // A service ADDED here can now charge for something it could not charge for before. Every screen offering
    // one of its steps has to be reread: anything saying the step costs nothing has just become untrue, and so
    // has any comment explaining why it is free. Take the amount from the shared cost constant rather than
    // writing a number into a screen, and assert the charge rather than the wording — a test pinned to the
    // sentence "this step is free" is what kept the last two lies green.
    //
    // A service REMOVED is the easier direction, but the screens still need rereading: a step that has stopped
    // costing money should stop saying it does.
    expect(actual).toEqual([...PAID_SERVICES].sort());
  });

  it("would actually notice a service that started charging", async () => {
    // A source regex is exactly the sort of check that silently matches nothing after a rename, so the spellings
    // it must catch — and the ones it must not — are pinned rather than assumed.
    const known = await fs.readFile(path.join(backendSource, "long-projects", "episode-scripts.service.ts"), "utf8");
    expect(BUDGET_DECLARATION.test(known)).toBe(true);

    for (const declaration of [
      "private readonly budget?: OpenAiBudget,",
      "private readonly budget: RunwayBudget,",
      'private readonly budget?: import("../providers/openai-budget.js").OpenAiBudget;',
      "constructor(budget: OpenAiBudget) {}",
    ]) {
      expect(BUDGET_DECLARATION.test(declaration)).toBe(true);
    }

    for (const notADeclaration of [
      'import { OpenAiBudget } from "../providers/openai-budget.js";',
      'import { OpenAiBudgetExceededError } from "../providers/openai-budget.js";',
      "catch (error) { if (error instanceof OpenAiBudgetExceededError) throw budgetExceeded(); }",
      "private readonly notABudget: string,",
    ]) {
      expect(BUDGET_DECLARATION.test(notADeclaration)).toBe(false);
    }
  });
});
