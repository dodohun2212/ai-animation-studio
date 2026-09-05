import { describe, expect, it } from "vitest";

import { withWarning } from "./warnings.js";

/**
 * A warning said twice is one fact, said twice.
 *
 * The rule was already written down in this repository — *"never stack the same sentence twice"* — and then
 * honoured in two places out of fourteen. The sentences that repeat are the ones that matter:
 * `spendUnrecordedWarning` is written every time a paid call succeeds and its ledger row does not, so a ledger
 * that stays unwritable adds one per scene, per run. Six identical instructions on a screen read as six
 * separate problems, and they push whatever else the project was saying out of view.
 */
describe("adding a warning to a project", () => {
  it("does not stack the same sentence twice", () => {
    const once = withWarning([], "ledger could not be written");
    expect(withWarning(once, "ledger could not be written")).toEqual(["ledger could not be written"]);
  });

  it("keeps two warnings that say different things, in the order they arrived", () => {
    // Identity is the whole sentence, deliberately: two warnings naming different scenes are two facts, and a
    // reader needs both. Order is kept because the earlier one is usually the cause of the later.
    const list = withWarning(withWarning([], "scene 1 was not recorded"), "scene 2 was not recorded");
    expect(list).toEqual(["scene 1 was not recorded", "scene 2 was not recorded"]);
  });

  it("returns a new list rather than changing the one it was given", () => {
    // Every caller spreads a stored project into a new object around this value. Mutating the array in place
    // would edit the record that is still being compared against, before it has been written.
    const existing = ["already there"];
    expect(withWarning(existing, "new one")).not.toBe(existing);
    expect(existing).toEqual(["already there"]);
    expect(withWarning(existing, "already there")).not.toBe(existing);
  });
});
