// @vitest-environment node
//
// Reads the component's source rather than rendering it, and jsdom gives `import.meta.url` an http:// URL that
// cannot be turned back into a path. Its own file because the rest of this component's tests need jsdom.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("SceneEditScreen draft reset", () => {
  it("is driven by the tab that was clicked, never by an effect watching the selection", async () => {
    // The proof that the behavioural test beside it cannot be. Putting the reset back into an effect on
    // [selected] was checked and every behavioural test still passed, because the gap it reopens is a
    // scheduling one that @testing-library closes; the damage showed up only as an unrelated test going red
    // about once in four full runs, which is not a guard.
    //
    // What is exactly statable is the shape. The selection changes on its own when the first scene is chosen
    // after loading, so anything clearing the draft in response to it clears an edit nobody decided to discard
    // — a person typing the moment the fields appear watched the text vanish and the save button go back to
    // disabled, with nothing said. Reading the source is the only place that is checkable.
    const source = await readFile(new URL("./SceneEditScreen.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\}, \[selected\]\)/);
  });
});
