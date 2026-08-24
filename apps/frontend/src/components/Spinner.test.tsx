import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("shows the given label as visible text with a status role", () => {
    render(<Spinner label="불러오는 중..." />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("불러오는 중...");
  });

  it("still matches the label via a plain text query, for screens that assert on it directly", () => {
    render(<Spinner label="검토 상태를 불러오는 중..." />);
    expect(screen.getByText("검토 상태를 불러오는 중...")).toBeTruthy();
  });

  it("merges extra className onto the root element", () => {
    render(<Spinner label="불러오는 중..." className="mt-8" />);
    expect(screen.getByRole("status").className).toContain("mt-8");
  });
});
