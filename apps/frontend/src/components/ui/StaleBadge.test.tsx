import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StaleBadge } from "./StaleBadge.js";

describe("StaleBadge", () => {
  it("marks a scene the server listed as stale", () => {
    render(<StaleBadge staleSceneNumbers={[2, 4]} sceneNumber={2} kind="image" data-testid="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveAttribute("data-stale-kind", "image");
    expect(badge.textContent).toContain("이미지");
  });

  it("renders nothing for a scene that is not in the list", () => {
    render(<StaleBadge staleSceneNumbers={[2, 4]} sceneNumber={3} kind="image" data-testid="badge" />);
    expect(screen.queryByTestId("badge")).toBeNull();
  });

  it("renders nothing when the server reported no staleness at all", () => {
    // An absent list means the server could not compute it — never treat that as "everything is stale".
    render(<StaleBadge staleSceneNumbers={undefined} sceneNumber={1} kind="video" data-testid="badge" />);
    expect(screen.queryByTestId("badge")).toBeNull();
  });

  it("names the artifact kind it is about", () => {
    render(<StaleBadge staleSceneNumbers={[1]} sceneNumber={1} kind="narration" data-testid="badge" />);
    expect(screen.getByTestId("badge").textContent).toContain("음성");
  });
});
