import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProject } from "../api/testUtils.js";
import { CreateLongProjectForm } from "./CreateLongProjectForm.js";

function fillRequiredFields(projectId: string, title: string, logline: string): void {
  fireEvent.change(screen.getByLabelText("폴더 이름"), { target: { value: projectId } });
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("한 줄 줄거리"), { target: { value: logline } });
}

describe("CreateLongProjectForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the required fields plus the supported long-project settings", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText("폴더 이름")).toBeTruthy();
    expect(screen.getByLabelText("제목")).toBeTruthy();
    expect(screen.getByLabelText("한 줄 줄거리")).toBeTruthy();
    expect(screen.getByLabelText("에피소드 수")).toBeTruthy();
    expect(screen.getByLabelText("장면 수")).toBeTruthy();
    expect(screen.getByLabelText("클립 길이(초)")).toBeTruthy();
    expect(screen.getByLabelText("화면 비율")).toBeTruthy();
  });

  /** item 5(D1): a new project has no model chosen yet, so it offers all of CLIP_DURATION_CHOICES, not just Runway's old 5·10. */
  it("offers the full curated set of clip durations, not just Runway's old 5/10", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    const select = screen.getByLabelText("클립 길이(초)") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["5", "10", "15", "20", "30"]);
  });

  it("rejects empty required fields (projectId, title, logline) without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<CreateLongProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    expect(await screen.findAllByRole("alert")).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("rejects a non-positive episode count without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    fillRequiredFields("long_test", "제목", "로그라인");
    fireEvent.change(screen.getByLabelText("에피소드 수"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    expect(await screen.findAllByRole("alert")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clamps a typed scene count to the supported range instead of accepting an out-of-bounds value", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    const sceneCountInput = screen.getByLabelText("장면 수") as HTMLInputElement;
    fireEvent.change(sceneCountInput, { target: { value: "0" } });
    expect(sceneCountInput.value).toBe("2");
    fireEvent.change(sceneCountInput, { target: { value: "99" } });
    expect(sceneCountInput.value).toBe("12");
  });

  it.each(["../outside", "a/b", "has space"])(
    "rejects an unsafe project ID (%s) without calling fetch",
    async (unsafeId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

      fillRequiredFields(unsafeId, "제목", "로그라인");
      fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("creates a long project on submit with the full settings payload and reports it back via onCreated", async () => {
    const project = makeLongProject({ id: "long_test", title: "우주 방랑자", logline: "귀환 이야기" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<CreateLongProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fillRequiredFields("long_test", "우주 방랑자", "귀환 이야기");
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.projectId).toBe("long_test");
    expect(body.settings.title).toBe("우주 방랑자");
    expect(body.settings.logline).toBe("귀환 이야기");
    expect(body.settings.aspectRatio).toBe("9:16");
  });

  /** item 6: 1:1 이 세 번째, 4:5(CLI Round 855/857)가 네 번째 선택지로 늘었고, 나머지와 똑같이 고르고 만들 수 있습니다. */
  it("offers 1:1 as a third aspect ratio choice and creates the project with it", async () => {
    const project = makeLongProject({ id: "long_test", title: "우주 방랑자", logline: "귀환 이야기" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    const select = screen.getByLabelText("화면 비율") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["9:16", "16:9", "1:1", "4:5"]);
    fireEvent.change(select, { target: { value: "1:1" } });

    fillRequiredFields("long_test", "우주 방랑자", "귀환 이야기");
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.settings.aspectRatio).toBe("1:1");
  });

  it("disables the submit button while submitting and lets only one rapid duplicate submit call fetch", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    fillRequiredFields("long_test", "제목", "로그라인");
    const submitButton = screen.getByRole("button", { name: "장기 프로젝트 생성" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(201, { project: makeLongProject({ id: "long_test" }) }));
    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });

  it("shows a safe backend error message identifiable via data-error-code, and does not call onCreated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "LONG_PROJECT_ALREADY_EXISTS", message: "raw backend detail" })),
    );
    const onCreated = vi.fn();
    render(<CreateLongProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fillRequiredFields("dup", "제목", "로그라인");
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    const alert = await screen.findByText((_, element) => element?.getAttribute("data-error-code") === "LONG_PROJECT_ALREADY_EXISTS");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(onCreated).not.toHaveBeenCalled();
  });

  // An Episode can now change its own scene count and clip length, so this number is what a new Episode starts
  // from — not what every Episode is. Both halves are asserted: the true wording present AND the old wording
  // gone, because leaving "에피소드당" in place next to the new line would keep the false claim on screen.
  it("calls the length a default for new Episodes rather than a fact about every Episode", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    const line = screen.getByTestId("long-create-episode-length");
    expect(line.textContent).toContain("새 회차 기본값");
    expect(line.textContent).not.toContain("에피소드당");
    expect(line.textContent).toContain("회차마다 장면 수와 클립 길이를 다르게");
    // The one thing that is not per-Episode still says so, in the same breath.
    expect(line.textContent).toContain("화면 비율은 작품 전체에 하나");
  });

  it("calls onCancel when Cancel is clicked", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onCancel = vi.fn();
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  /** CLI Round 1199: 이야기 방향 여섯 칸은 접힌 「추가 설정 (선택)」 안 — 펼치지 않아도 만들 수 있고, 펼쳐 적은 값은 그대로 실립니다. */
  it("keeps the six story-direction fields in a closed optional group", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);
    const group = screen.getByTestId("long-create-story-group") as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.textContent).toContain("추가 설정 (선택)");
    for (const label of ["누가 볼 영상인가", "메모", "시작 상태", "중간 전개", "결말 방향", "스토리 흐름 요약"]) {
      expect(group.contains(screen.getByLabelText(label))).toBe(true);
    }
    // 필수 칸과 개요는 바깥에 그대로.
    expect(group.contains(screen.getByLabelText("한 줄 줄거리"))).toBe(false);
    expect(group.contains(screen.getByLabelText("개요"))).toBe(false);
    expect(screen.getByTestId("long-create-story-group-summary").textContent).toBe("비워 둬도 됩니다");
  });

  it("creates with only the required fields, the optional group never opened", async () => {
    const project = makeLongProject({ id: "long_test" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<CreateLongProjectForm onCreated={onCreated} onCancel={() => {}} />);
    fillRequiredFields("long_test", "우주 방랑자", "귀환 이야기");
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect((screen.getByTestId("long-create-story-group") as HTMLDetailsElement).open).toBe(false);
  });

  it("sends what was written in the optional group, and counts it in the closed summary", async () => {
    const project = makeLongProject({ id: "long_test" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);
    fillRequiredFields("long_test", "우주 방랑자", "귀환 이야기");
    fireEvent.change(screen.getByLabelText("중간 전개"), { target: { value: "동료가 배신한다" } });
    fireEvent.change(screen.getByLabelText("결말 방향"), { target: { value: "집으로 돌아온다" } });
    expect(screen.getByTestId("long-create-story-group-summary").textContent).toBe("2칸 적음");
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.settings.midpoint).toBe("동료가 배신한다");
    expect(body.settings.endingDirection).toBe("집으로 돌아온다");
  });

  it("says how the look-alike fields differ, without changing their names", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("무슨 이야기인지 한 문장으로.")).toBeTruthy();
    expect(screen.getByText(/한 줄 줄거리보다 길게/)).toBeTruthy();
    expect(screen.getByText(/판을 뒤집는 사건 하나/)).toBeTruthy();
    expect(screen.getByText(/시작·중간·결말을 이어서/)).toBeTruthy();
  });
});
