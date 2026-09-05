import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUDGET_LIMIT_ROUTE_HINT } from "@ai-animation-studio/shared";

// new URL(".", import.meta.url) does not resolve to a file URL under this suite — the same trap
// contract-value-sets.test.ts documents. path.dirname of the module path is the form that works here.
const apiDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Every `SOMETHING_BUDGET_EXCEEDED: "..."` / `budget_exceeded: "..."` entry in the client's message maps. */
function budgetRefusalMessages(): { file: string; key: string; message: string }[] {
  const found: { file: string; key: string; message: string }[] = [];
  for (const file of fs.readdirSync(apiDirectory).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const source = fs.readFileSync(path.join(apiDirectory, file), "utf8");
    for (const match of source.matchAll(/^\s*([A-Za-z_]*[Bb][Uu][Dd][Gg][Ee][Tt]_[Ee][Xx][Cc][Ee][Ee][Dd][Ee][Dd]):\s*[`"]([^`"]*)[`"],/gm)) {
      found.push({ file, key: match[1]!, message: match[2]! });
    }
  }
  return found;
}

describe("a budget refusal says where to go", () => {
  /**
   * A refusal with no way out is not information.
   *
   * While the monthly limit was a constant nobody could reach, "이번 달 예산을 초과했습니다" was the whole truth —
   * the only ways past it were to wait for the calendar month or to hand-edit the spend ledger, and neither
   * belongs in an error message. The limit is on the settings screen now. A refusal that does not mention it
   * leaves the person exactly where the old one did, and this is the rule that catches the next one added
   * without it rather than the ten that exist today.
   */
  it("names the settings screen in every budget-exceeded message the client can show", () => {
    const messages = budgetRefusalMessages();
    expect(messages.length, "the scan found no messages at all, which means it stopped working").toBeGreaterThanOrEqual(10);

    const silent = messages.filter((entry) => !entry.message.includes("${BUDGET_LIMIT_ROUTE_HINT}") && !entry.message.includes(BUDGET_LIMIT_ROUTE_HINT));
    expect(silent.map((entry) => `${entry.file}: ${entry.key}`), "these refuse without saying the limit can be raised").toEqual([]);
  });

  /** One sentence, so changing where the limit lives does not mean finding eleven copies of a screen's name. */
  it("uses the shared sentence rather than each file's own wording", () => {
    for (const entry of budgetRefusalMessages()) {
      expect(entry.message, `${entry.file}: ${entry.key} spells it out instead of interpolating the shared constant`)
        .toContain("${BUDGET_LIMIT_ROUTE_HINT}");
    }
  });
});
