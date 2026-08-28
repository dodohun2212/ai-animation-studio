import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every request field in the contract is named somewhere in this app's own source.
 *
 * Four separate bugs this month were the same shape: both ends were fine and the middle was missing. A secret's
 * `revealAvailableEpisode` was accepted, stored and split on by the script prompt, but no screen ever asked for
 * it — so every secret was always revealable and the forbidden list was always empty. `userRequestId` travelled
 * on every video start and matched nothing because it was minted per press. A Story Bible Asset link was
 * validated and persisted and read by nothing at all.
 *
 * None of that is visible to a typechecker: an optional field nobody sends typechecks perfectly, and the
 * server's tests prove only that it *accepts* one. So this looks from the other side — the contract says the
 * server takes this field; does this app ever mention it?
 *
 * A name appearing here is weak evidence, deliberately: proving a field is really *sent* would mean running
 * every screen, and a guard nobody can keep passing gets deleted. Not appearing at all is strong evidence, and
 * that is the half worth catching. When this fails, the question to answer is not "how do I make it green" but
 * "did we wire this up, or does the contract carry a field nothing needs?"
 */
describe("contract request coverage", () => {
  it("names every request field the contract accepts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const contract = fs.readFileSync(path.resolve(here, "../../../../packages/shared/src/api.ts"), "utf8");

    // Counting braces rather than matching to one. Two shapes live in this file — a one-liner and a block —
    // and both regexes I tried before this read the wrong text: stopping at the first `}` cut the interfaces
    // holding an inline object in half, and running to a line-start `}` made the one-liners swallow whatever
    // came after them. Both were caught by the two assertions below, not by review.
    const fields = new Map<string, string>();
    for (const opening of contract.matchAll(/export interface (\w*Request)\s*\{/g)) {
      let depth = 1;
      let index = opening.index + opening[0].length;
      while (depth > 0 && index < contract.length) {
        if (contract[index] === "{") depth += 1;
        else if (contract[index] === "}") depth -= 1;
        index += 1;
      }
      const body = contract.slice(opening.index + opening[0].length, index - 1);
      // A one-liner puts its fields on the same line as the brace, a block on their own lines.
      for (const match of body.matchAll(/(?:^|[{;])\s*(\w+)\??\s*:/gm)) { const field = match[1]!; if (!fields.has(field)) fields.set(field, opening[1]!); }
    }
    // Cheap proof the parse found something real rather than silently matching nothing.
    expect(fields.size).toBeGreaterThan(50);

    const sources: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) sources.push(fs.readFileSync(full, "utf8"));
      }
    };
    walk(path.resolve(here, ".."));
    const app = sources.join("\n");

    const unmentioned = [...fields].filter(([field]) => !new RegExp(`\\b${field}\\b`).test(app)).map(([field, owner]) => `${field} (${owner})`);
    expect(unmentioned).toEqual([]);
  });
});
