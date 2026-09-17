import { LONG_EPISODE_OUTLINE_STATUSES } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArchiveApiError, listArchivedLongProjects, listArchivedProjects, toArchiveDisplayError } from "./archiveApi.js";
import { jsonResponse, nonJsonResponse } from "./testUtils.js";

function archivedLong(overrides: Record<string, unknown> = {}) {
  return {
    id: "long_archived",
    title: "우주 방랑자",
    logline: "떠도는 항해사가 고향 별을 되찾는다.",
    episodeCount: 3,
    outlineStatus: "planned",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    archivedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("archiveApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * 🔴 `00_NOW` 「받아 둔 것」의 그 항목 — 이 가드가 `"planned" || "outline_ready"` 를 손으로 적고 있었고,
   * 지금은 계약의 목록을 읽습니다. **고친 것은 이미 디스크에 있었지만 그걸 지키는 짝이 없었습니다**
   * (Cowork Round 899). 코드가 맞다는 것과, 다음 사람이 그걸 되돌릴 수 없다는 것은 다른 문장입니다.
   *
   * 이게 응답 **가드**라는 점이 이 짝을 값지게 만듭니다. 라벨 표(④)가 어긋나면 화면에 이상한 글자가
   * 뜨지만, 가드가 어긋나면 **멀쩡한 응답이 malformed 로 거절**되고 화면은 돌고 있는 서버를 두고
   * 「서버 응답을 확인할 수 없습니다」라고 말합니다. 그리고 컴파일은 아무 말도 하지 않습니다 —
   * 손으로 적은 문자열 비교는 타입이 아니니까요.
   */
  it("accepts an archived long project in every outline status the contract allows", async () => {
    for (const outlineStatus of LONG_EPISODE_OUTLINE_STATUSES) {
      const projects = [archivedLong({ outlineStatus })];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects })));
      await expect(listArchivedLongProjects(), outlineStatus).resolves.toEqual({ projects });
    }
  });

  /**
   * 위 짝의 반쪽. 「전부 통과한다」만 있으면 가드를 `() => true` 로 바꿔도 초록이라, 거절이 아직
   * 살아 있다는 것도 같이 말해야 합니다.
   */
  it("still refuses an outline status the contract does not name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [archivedLong({ outlineStatus: "not_a_status" })] })));
    await expect(listArchivedLongProjects()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("reads the two archive listings from the contract's own routes", async () => {
    const shortFetch = vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] }));
    vi.stubGlobal("fetch", shortFetch);
    await listArchivedProjects();
    expect(String(shortFetch.mock.calls[0]?.[0])).toBe("/projects/archived");

    const longFetch = vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] }));
    vi.stubGlobal("fetch", longFetch);
    await listArchivedLongProjects();
    expect(String(longFetch.mock.calls[0]?.[0])).toBe("/long-projects/archived");
  });

  /**
   * 5xx 에 서버의 오류 모양조차 없으면 그건 **서버가 대답을 안 한 것**입니다(꺼졌거나 재시작 중이거나
   * 앞단이 대신 답한 것). 「응답을 확인할 수 없습니다」는 돌지도 않는 서버를 응답 탓으로 돌려, 사람을
   * 엉뚱한 곳으로 보냅니다 — `httpError.ts` 가 이 구분을 위해 있습니다.
   */
  it("reports a 5xx with no error shape as the server not answering, not as a bad answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));
    await expect(listArchivedProjects()).rejects.toMatchObject({ code: "CLIENT_SERVER_UNAVAILABLE" });
  });

  it("never surfaces the backend's raw message for a known refusal", () => {
    const displayed = toArchiveDisplayError(new ArchiveApiError("PROJECT_RESTORE_COLLISION", "raw backend detail C:/Users/someone"));
    expect(displayed.code).toBe("PROJECT_RESTORE_COLLISION");
    expect(displayed.message).toContain("이미 있어 복구할 수 없습니다");
    expect(displayed.message).not.toContain("raw backend detail");
    expect(displayed.message).not.toContain("C:/Users");
  });

  it("falls back safely for a code it does not know", () => {
    const displayed = toArchiveDisplayError(new ArchiveApiError("SOMETHING_NEW", "raw internal detail"));
    expect(displayed.message).not.toContain("raw internal detail");
  });
});
