import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StillMotion } from "@ai-animation-studio/shared";

import { StillMotionFieldset } from "./StillMotionFieldset.js";

function videoResponse(): Response {
  return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }), { status: 200, headers: { "content-type": "video/mp4" } });
}

describe("StillMotionFieldset", () => {
  const created: string[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    let n = 0;
    // jsdom 에는 두 함수가 없습니다 — 생성자 `URL` 은 그대로 두고 두 정적 함수만 붙입니다.
    URL.createObjectURL = (() => { const url = `blob:preview-${++n}`; created.push(url); return url; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("offers one motion per picture and reports a change by picture index", () => {
    const onChange = vi.fn();
    render(<StillMotionFieldset projectId="card" motions={["zoom_in", "zoom_in"]} onChange={onChange} />);
    expect((screen.getByTestId("merge-still-motion-1") as HTMLSelectElement).value).toBe("zoom_in");
    expect(screen.getByTestId("merge-still-motion-2")).toBeTruthy();
    fireEvent.change(screen.getByTestId("merge-still-motion-2"), { target: { value: "pan_right" } });
    expect(onChange).toHaveBeenCalledWith(1, "pan_right");
  });

  /**
   * 미리보기는 몇 초짜리 실제 렌더입니다 — 굽는 동안 다른 미리보기 단추는 닫히고, 다 되면 소리 없는 플레이어가 뜹니다.
   * 다시 구우면 앞의 Blob 주소는 놓습니다(안 놓으면 미리보기마다 영상 한 편이 메모리에 남습니다).
   */
  it("renders a silent preview for one picture, blocks repeat clicks meanwhile, and releases the old blob", async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(videoResponse());
    vi.stubGlobal("fetch", fetchMock);
    const motions: StillMotion[] = ["zoom_out", "still"];
    render(<StillMotionFieldset projectId="card" motions={motions} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.6 }} />);

    fireEvent.click(screen.getByTestId("merge-still-motion-preview-1"));
    expect((screen.getByTestId("merge-still-motion-preview-2") as HTMLButtonElement).disabled, "굽는 동안 다른 단추는 닫힙니다").toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)))
      .toEqual({ sceneNumber: 1, motion: "zoom_out", subtitleLayout: { scale: 0.03, center: 0.6 } });

    release(videoResponse());
    const player = await screen.findByTestId("merge-still-motion-player");
    expect(player.getAttribute("src")).toBe("blob:preview-1");
    expect(screen.getByTestId("merge-still-motion-preview").textContent).toContain("소리 없는");

    fireEvent.click(screen.getByTestId("merge-still-motion-preview-2"));
    await waitFor(() => expect(screen.getByTestId("merge-still-motion-player").getAttribute("src")).toBe("blob:preview-2"));
    expect(revoked).toContain("blob:preview-1");
  });

  /** 굽는 중에 화면을 떠나면, 늦게 온 응답으로 Blob 주소를 만들지 않습니다(놓을 주인이 없습니다 — CLI Round 1151). */
  it("makes no blob url for a preview that comes back after the screen is gone", async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const view = render(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("merge-still-motion-preview-1"));
    view.unmount();
    release(videoResponse());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created).toEqual([]);
  });

  /** 미리보기 뒤에 자막 슬라이더를 움직이면, 보고 있는 미리보기는 옛 자막입니다 — 그렇게 말합니다. */
  it("says the preview is stale once the card's subtitle has moved since", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(videoResponse()));
    const view = render(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.6 }} />);
    fireEvent.click(screen.getByTestId("merge-still-motion-preview-1"));
    await screen.findByTestId("merge-still-motion-player");
    expect(screen.queryByTestId("merge-still-motion-preview-stale-layout")).toBeNull();
    view.rerender(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.5 }} />);
    expect(screen.getByTestId("merge-still-motion-preview-stale-layout").textContent).toContain("자막");
  });

  /** CLI Round 1265: 효과도 미리보기에 구워집니다 — 효과만 바꿔도 보고 있는 영상은 옛 효과라고 말하고, 요청에는 고른 효과를 그대로 싣습니다. */
  it("sends the unsaved effect with the preview and calls the preview stale once only the effect changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(videoResponse());
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.6, effect: "ocean_wave" }} />);
    fireEvent.click(screen.getByTestId("merge-still-motion-preview-1"));
    await screen.findByTestId("merge-still-motion-player");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body)).subtitleLayout).toEqual({ scale: 0.03, center: 0.6, effect: "ocean_wave" });
    expect(screen.queryByTestId("merge-still-motion-preview-stale-layout")).toBeNull();
    view.rerender(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.6, effect: "cosmic" }} />);
    expect(screen.getByTestId("merge-still-motion-preview-stale-layout").textContent).toContain("효과");
  });

  it("does not call a preview stale when a missing effect becomes the lightning it already meant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(videoResponse()));
    const view = render(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.6 }} />);
    fireEvent.click(screen.getByTestId("merge-still-motion-preview-1"));
    await screen.findByTestId("merge-still-motion-player");
    view.rerender(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} subtitleLayout={{ scale: 0.03, center: 0.6, effect: "lightning" }} />);
    expect(screen.queryByTestId("merge-still-motion-preview-stale-layout")).toBeNull();
  });

  it("says the preview failed in its own words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "FFMPEG_UNAVAILABLE", message: "raw C:/x" }), { status: 503, headers: { "content-type": "application/json" } })));
    render(<StillMotionFieldset projectId="card" motions={["still"]} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("merge-still-motion-preview-1"));
    const error = await screen.findByTestId("merge-still-motion-preview-error");
    expect(error.textContent).toContain("사진 1");
    expect(error.textContent).not.toContain("raw");
  });
});
