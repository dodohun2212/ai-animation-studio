import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FinalVideoGenerationSourceNotice, GenerationSourceBadge } from "./GenerationSourceNotice.js";

describe("GenerationSourceNotice", () => {
  it("distinguishes paid, temporary, and legacy image results without guessing when absent", () => {
    const { rerender } = render(<GenerationSourceBadge source="paid_provider" testId="source" />);
    expect(screen.getByTestId("source")).toHaveTextContent("실제 생성");

    rerender(<GenerationSourceBadge source="local_fake_no_provider" testId="source" />);
    expect(screen.getByTestId("source")).toHaveTextContent("임시 생성");

    rerender(<GenerationSourceBadge source="unknown_legacy" testId="source" />);
    expect(screen.getByTestId("source")).toHaveTextContent("생성 출처 확인 필요");

    rerender(<GenerationSourceBadge testId="source" />);
    expect(screen.queryByTestId("source")).toBeNull();
  });

  // The badge shares a line with the scene's own status chip on both image review screens. Whatever tone it
  // takes, it must not take the one that already means 완료 there — two green pills a finger-width apart,
  // saying different things, is how a reviewer learns to stop reading either of them.
  it("never wears the done-color, because where it is drawn that color already means 확정됨", () => {
    const tones: string[] = [];
    const { rerender } = render(<GenerationSourceBadge source="paid_provider" testId="source" />);
    tones.push(screen.getByTestId("source").getAttribute("data-tone") ?? "");

    rerender(<GenerationSourceBadge source="local_fake_no_provider" testId="source" />);
    tones.push(screen.getByTestId("source").getAttribute("data-tone") ?? "");

    rerender(<GenerationSourceBadge source="unknown_legacy" testId="source" />);
    tones.push(screen.getByTestId("source").getAttribute("data-tone") ?? "");

    expect(tones).toEqual(["neutral", "progress", "info"]);
    expect(tones).not.toContain("success");
  });

  it("warns only when a final video cannot safely be treated as paid-provider output", () => {
    const { rerender } = render(<FinalVideoGenerationSourceNotice source="local_fake_no_provider" testId="notice" />);
    expect(screen.getByTestId("notice")).toHaveTextContent("Instagram 게시에는 사용할 수 없습니다");

    rerender(<FinalVideoGenerationSourceNotice source="unknown_legacy" testId="notice" />);
    expect(screen.getByTestId("notice")).toHaveTextContent("생성 출처를 확인할 수 없습니다");

    rerender(<FinalVideoGenerationSourceNotice source="paid_provider" testId="notice" />);
    expect(screen.queryByTestId("notice")).toBeNull();
  });
});
