import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProject } from "../api/testUtils.js";
import { CreateLongProjectForm } from "./CreateLongProjectForm.js";

function fillRequiredFields(projectId: string, title: string, logline: string): void {
  fireEvent.change(screen.getByLabelText("프로젝트 ID"), { target: { value: projectId } });
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("로그라인"), { target: { value: logline } });
}

describe("CreateLongProjectForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the required fields plus the supported long-project settings", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText("프로젝트 ID")).toBeTruthy();
    expect(screen.getByLabelText("제목")).toBeTruthy();
    expect(screen.getByLabelText("로그라인")).toBeTruthy();
    expect(screen.getByLabelText("에피소드 수")).toBeTruthy();
    expect(screen.getByLabelText("에피소드 길이(초)")).toBeTruthy();
    expect(screen.getByLabelText("플랫폼")).toBeTruthy();
    expect(screen.getByLabelText("화면 비율")).toBeTruthy();
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

  it("rejects a non-positive episode count or duration without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={() => {}} />);

    fillRequiredFields("long_test", "제목", "로그라인");
    fireEvent.change(screen.getByLabelText("에피소드 수"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("에피소드 길이(초)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(body.settings.platform).toBe("YouTube Shorts");
    expect(body.settings.aspectRatio).toBe("9:16");
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

  it("calls onCancel when Cancel is clicked", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onCancel = vi.fn();
    render(<CreateLongProjectForm onCreated={() => {}} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
