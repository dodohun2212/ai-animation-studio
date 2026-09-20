import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SceneSubtitleLayout } from "@ai-animation-studio/shared";
import { DEFAULT_SCENE_SUBTITLE_LAYOUT } from "@ai-animation-studio/shared";

import { SceneSubtitleFieldset } from "./SceneSubtitleFieldset.js";

const SCENES = [{ number: 1 as const, text: "첫 번째 장면의 나레이션입니다." }];

function renderFieldset(layout: SceneSubtitleLayout, savedLayout?: SceneSubtitleLayout, onChange = vi.fn()) {
  render(
    <SceneSubtitleFieldset
      previewImageUrl={(sceneNumber) => `/projects/12/scenes/${sceneNumber}/image`}
      scenes={SCENES}
      aspectRatio="9:16"
      layout={layout}
      savedLayout={savedLayout}
      onChange={onChange}
    />,
  );
  return onChange;
}

/**
 * 🔴 「지금 영상의 값으로」가 **명언 카드에만** 있었습니다.
 *
 * 캡틴D께서 카드에서 이걸 버그로 보셨고, 버그가 아니라 **되돌릴 길이 없던 것**이었습니다. 카드는 고쳐졌는데
 * 단편·회차의 장면 자막은 그대로였습니다 — 슬라이더를 살짝 움직여 본 사람에게 되돌릴 방법이 **새로고침**
 * 밖에 없었고, 그 상태의 미리보기는 완성된 영상과 다르게 보이면서 **왜 다른지는 말하지 않았습니다.**
 */
describe("SceneSubtitleFieldset", () => {
  it("offers the way back to the values the finished video was burned with", () => {
    const saved = { scale: 0.045, center: 0.72 };
    const onChange = renderFieldset({ scale: 0.055, center: 0.84 }, saved);

    fireEvent.click(screen.getByTestId("scene-subtitle-restore"));

    expect(onChange).toHaveBeenCalledWith(saved);
    // 🔴 공장 기본값이 아닙니다 — 그걸 돌려주면 **세 번째 자리**로 보내는 셈입니다. 슬라이더가 시작한
    // 곳도 아니고, 아래 영상이 보여 주는 값도 아닙니다.
    expect(onChange).not.toHaveBeenCalledWith(DEFAULT_SCENE_SUBTITLE_LAYOUT);
  });

  it("hides that way back when the sliders already sit on the saved values", () => {
    const saved = { scale: 0.045, center: 0.72 };
    renderFieldset({ ...saved }, saved);

    expect(screen.queryByTestId("scene-subtitle-restore"), "돌아갈 데가 이미 여기입니다").toBeNull();
  });

  /** 아직 한 번도 합치지 않은 프로젝트에는 「지금 영상」이 없습니다 — 돌아갈 곳이 없으니 버튼도 없습니다. */
  it("offers no way back before the first merge", () => {
    renderFieldset({ scale: 0.055, center: 0.84 });

    expect(screen.queryByTestId("scene-subtitle-restore")).toBeNull();
    // 🟠 「기본값으로」는 그때도 있습니다 — 그게 그때는 **유일하게 아는 값**이라서요.
    expect(screen.getByTestId("scene-subtitle-reset")).toBeTruthy();
  });
});
