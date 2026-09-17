import { describe, expect, it } from "vitest";

import { SceneEditApiError, toSceneEditDisplayError } from "./sceneEditApi.js";

describe("sceneEditApi", () => {
  /**
   * 🔴 이 모듈만 `UNSAFE_PROJECT_ID` 를 「프로젝트를 찾을 수 없습니다」라고 말했습니다 (Cowork Round 907).
   *
   * 두 문장이 사람을 **서로 다른 곳으로** 보냅니다. 「찾을 수 없다」는 없어진 프로젝트를 찾으러 목록을
   * 뒤지게 하고, 그 사람은 프로젝트가 멀쩡히 있는 걸 보고 앱이 고장났다고 결론냅니다. 실제 문제는 이름에
   * 쓸 수 없는 글자가 들어간 것이고, 그건 **고칠 수 있는 것**입니다.
   *
   * 나머지 네 모듈(`projectsApi` · `longProjectsApi` · `photoCardsApi` · `longStoryBibleApi`)은 전부 이름
   * 이야기를 합니다. 「같은 문구가 여러 곳에 손으로 적혀 있다」를 재다가 나온 것인데, 문구를 모으는 문제
   * 이전에 **한 곳만 다른 뜻으로 읽히고 있던 것**이라 그것부터 고쳤습니다.
   */
  it("says the id has characters it cannot use, not that the project is missing", () => {
    const displayed = toSceneEditDisplayError(new SceneEditApiError("UNSAFE_PROJECT_ID", "raw backend detail"));

    expect(displayed.code).toBe("UNSAFE_PROJECT_ID");
    expect(displayed.message).toContain("사용할 수 없는 문자");
    // 🔴 이 한 줄이 이 짝의 전부입니다 — 없어진 프로젝트를 찾으러 보내면 안 됩니다.
    expect(displayed.message).not.toContain("찾을 수 없습니다");
    expect(displayed.message).not.toContain("raw backend detail");
  });

  /** 진짜로 없는 프로젝트는 여전히 없다고 말해야 합니다 — 위 수정이 이걸 같이 바꾸면 안 됩니다. */
  it("still says a genuinely missing project is missing", () => {
    const displayed = toSceneEditDisplayError(new SceneEditApiError("PROJECT_NOT_FOUND", "raw"));
    expect(displayed.message).toContain("찾을 수 없습니다");
  });

  it("never surfaces the backend's own words for a code it does not know", () => {
    const displayed = toSceneEditDisplayError(new SceneEditApiError("SOMETHING_NEW", "raw internal detail"));
    expect(displayed.code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(displayed.message).not.toContain("raw internal detail");
  });

  /** 이 모듈의 것이 아닌 것(평범한 `Error`)도 안전 문장으로 떨어집니다 — 영문 원문이 화면에 오면 안 됩니다. */
  it("maps anything that is not this module's error to the safe fallback", () => {
    const displayed = toSceneEditDisplayError(new Error("TypeError: cannot read properties of undefined"));
    expect(displayed.code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(displayed.message).not.toContain("TypeError");
  });
});
