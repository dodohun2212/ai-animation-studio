import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MonthlyBudgetCard } from "./MonthlyBudgetCard.js";
import { jsonResponse, makeMonthlyBudget } from "../api/testUtils.js";

afterEach(() => { vi.unstubAllGlobals(); });

const budgets = {
  openai: makeMonthlyBudget({ provider: "openai", monthlyLimitUsd: 10, isDefault: true, spentUsd: 1.95, remainingUsd: 8.05 }),
  runway: makeMonthlyBudget({ provider: "runway", monthlyLimitUsd: 10, isDefault: true, spentUsd: 3, remainingUsd: 7 }),
};

describe("MonthlyBudgetCard", () => {
  /**
   * A limit on its own answers no question. "$10" tells nobody whether to start a cycle; "$3.00 씀 · $7.00
   * 남음" is the whole reason someone opens this screen before spending money.
   */
  it("shows each provider's limit next to what has actually been spent against it", () => {
    render(<MonthlyBudgetCard budgets={budgets} onBudgetChange={() => {}} />);
    expect(screen.getByTestId("monthly-budget-openai")).toHaveTextContent("$1.95 씀");
    expect(screen.getByTestId("monthly-budget-openai")).toHaveTextContent("$8.05 남음");
    expect(screen.getByTestId("monthly-budget-runway")).toHaveTextContent("$7.00 남음");
  });

  /** "Nobody has chosen" is a different fact from "somebody chose $10" — only the first is the app's opinion. */
  it("says the built-in limit is a default until somebody sets one", () => {
    const { rerender } = render(<MonthlyBudgetCard budgets={budgets} onBudgetChange={() => {}} />);
    expect(screen.getByTestId("monthly-budget-openai")).toHaveTextContent("기본값");

    rerender(<MonthlyBudgetCard budgets={{ ...budgets, openai: { ...budgets.openai, monthlyLimitUsd: 25, isDefault: false } }} onBudgetChange={() => {}} />);
    expect(screen.getByTestId("monthly-budget-openai")).not.toHaveTextContent("기본값");
  });

  it("saves one provider's limit without touching the other", async () => {
    const saved = makeMonthlyBudget({ provider: "runway", monthlyLimitUsd: 40, isDefault: false, spentUsd: 3, remainingUsd: 37 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { budget: saved }));
    vi.stubGlobal("fetch", fetchMock);
    const onBudgetChange = vi.fn();
    render(<MonthlyBudgetCard budgets={budgets} onBudgetChange={onBudgetChange} />);

    fireEvent.change(screen.getByLabelText("Runway — 영상 월 한도"), { target: { value: "40" } });
    fireEvent.click(screen.getAllByRole("button", { name: "저장" })[1]!);

    await waitFor(() => expect(onBudgetChange).toHaveBeenCalledWith(saved));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/settings/providers/runway/monthly-budget");
    expect(JSON.parse((options as { body: string }).body)).toEqual({ monthlyLimitUsd: 40 });
  });

  /**
   * A limit nobody typed must not reach the server, and the person must be told why here rather than after a
   * round trip. The server refuses the same values — this is the message, not the decision.
   */
  it("refuses a limit that is not a positive amount, without sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<MonthlyBudgetCard budgets={budgets} onBudgetChange={() => {}} />);

    for (const value of ["0", "-5", "abc", " "]) {
      fireEvent.change(screen.getByLabelText("OpenAI — 글·그림·목소리 월 한도"), { target: { value } });
      fireEvent.click(screen.getAllByRole("button", { name: "저장" })[0]!);
      expect(await screen.findByRole("alert")).toHaveTextContent("0보다 큰 금액");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * An unreadable ledger leaves the spend unknown, and this card must not fill that in as zero — it sits
   * directly beside a field for raising a spending limit, and "$0.00 씀" is the most encouraging thing it
   * could possibly say.
   */
  it("says the spend is unknown rather than showing zero when the server could not read the ledger", () => {
    render(<MonthlyBudgetCard
      budgets={{ ...budgets, openai: makeMonthlyBudget({ provider: "openai", spendUnavailable: true, spentUsd: 0, remainingUsd: 10 }) }}
      onBudgetChange={() => {}}
    />);
    const card = screen.getByTestId("monthly-budget-openai");
    expect(card).toHaveTextContent("사용액을 읽지 못했습니다");
    expect(card).not.toHaveTextContent("$0.00 씀");
    expect(card, "and the limit is still there to change").toHaveTextContent("월 한도");
  });
});
