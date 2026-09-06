import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { CreateFlowerReelForm } from "./CreateFlowerReelForm.js";

const created = { project: makeProject({ id: "꽃말_장미" }), review: { scriptRevision: 1, items: [] } };

function fill() {
  fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
  fireEvent.change(screen.getByTestId("flower-meaning"), { target: { value: "열정" } });
  fireEvent.change(screen.getByTestId("flower-caption-0"), { target: { value: "모든 꽃은 흙 속에서 시작한다." } });
  fireEvent.change(screen.getByTestId("flower-caption-1"), { target: { value: "장미의 꽃말은 열정이다." } });
}

describe("CreateFlowerReelForm", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends the flower, its meaning and every typed scene, then hands the project on", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, created));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<CreateFlowerReelForm onCreated={onCreated} onCancel={() => {}} />);

    fill();
    fireEvent.click(screen.getByTestId("flower-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/flower-cards");
    const sent = JSON.parse(String(init.body)) as { flowerName: string; scenes: { caption: string }[] };
    expect(sent.flowerName).toBe("장미");
    expect(sent.scenes).toHaveLength(2);
    expect(sent.scenes[1]!.caption).toBe("장미의 꽃말은 열정이다.");
  });

  // The folder name is offered, not demanded — but it is still the real allow-list, which accepts Hangul.
  it("suggests a folder name from the flower and keeps a typed one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, created)));
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
    expect((screen.getByTestId("flower-project-id") as HTMLInputElement).value).toBe("꽃말_장미");

    fireEvent.change(screen.getByTestId("flower-project-id"), { target: { value: "rose_01" } });
    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "수국" } });
    expect((screen.getByTestId("flower-project-id") as HTMLInputElement).value).toBe("rose_01");
  });

  /**
   * 🔴 The pre-written beats are the screen's only lever against the seam.
   *
   * Each scene's video is generated from its own separately-drawn picture — nothing carries the previous
   * clip's last frame forward — so the flower can come out different in each shot. Naming the flower in every
   * beat, and repeating that the pot, angle and light do not change, is what fights that. A template that
   * stopped following the flower name would quietly drop half of it.
   */
  it("keeps the pre-written beats following the flower name, until one is edited", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
    expect((screen.getByTestId("flower-description-0") as HTMLTextAreaElement).value).toContain("장미");
    expect((screen.getByTestId("flower-description-1") as HTMLTextAreaElement).value).toContain("같은 각도");

    fireEvent.change(screen.getByTestId("flower-description-0"), { target: { value: "내가 쓴 묘사" } });
    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "수국" } });
    // Edited stays; untouched follows.
    expect((screen.getByTestId("flower-description-0") as HTMLTextAreaElement).value).toBe("내가 쓴 묘사");
    expect((screen.getByTestId("flower-description-1") as HTMLTextAreaElement).value).toContain("수국");
  });

  it("adds beats when the scene count grows, and asks for a caption on each", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    fill();
    expect(screen.getByTestId("flower-submit")).not.toHaveProperty("disabled", true);

    fireEvent.change(screen.getByTestId("flower-scene-count"), { target: { value: "3" } });

    expect((screen.getByTestId("flower-description-2") as HTMLTextAreaElement).value.length).toBeGreaterThan(0);
    // The new scene has no caption yet, so the button waits rather than sending a beat with no line under it.
    expect((screen.getByTestId("flower-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  // Said here because it is the difference between this door and the other one, and it is why the script is typed.
  it("says the create step costs nothing", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("flower-free-note").textContent).toContain("비용이 들지 않습니다");
    // And warns about the seam, which is the honest limit of making each scene separately.
    expect(screen.getByTestId("flower-seam-note").textContent).toContain("달라질 수 있습니다");
  });

  it("does not submit until the flower, the meaning and every caption are filled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    expect((screen.getByTestId("flower-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("flower-submit"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
