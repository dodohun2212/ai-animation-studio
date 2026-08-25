import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { CreateProjectForm } from "./CreateProjectForm.js";

function fillForm(projectId: string, topic: string): void {
  fireEvent.change(screen.getByLabelText("프로젝트 ID"), { target: { value: projectId } });
  fireEvent.change(screen.getByLabelText("영상 주제"), { target: { value: topic } });
}

describe("CreateProjectForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses exactly two fields: projectId and topic", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateProjectForm onCreated={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText("프로젝트 ID")).toBeTruthy();
    expect(screen.getByLabelText("영상 주제")).toBeTruthy();
    expect(screen.queryByLabelText("프로젝트 이름")).toBeNull();
    expect(screen.queryByLabelText(/이름/)).toBeNull();
  });

  it("rejects empty required fields without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<CreateProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it.each(["../outside", "a/b", "a\\b", "has space", ".", "%2e%2e%2f"])(
    "rejects an unsafe project ID (%s) without calling fetch",
    async (unsafeId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<CreateProjectForm onCreated={() => {}} onCancel={() => {}} />);

      fillForm(unsafeId, "topic");
      fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("allows a Korean project ID", async () => {
    const project = makeProject({ id: "우주_고양이", topic: "topic" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { project })));
    const onCreated = vi.fn();
    render(<CreateProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fillForm("우주_고양이", "topic");
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
  });

  it("creates a project on submit and reports it back via onCreated", async () => {
    const project = makeProject({ id: "sample_project", topic: "우주를 여행하는 고양이" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { project })));
    const onCreated = vi.fn();
    render(<CreateProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fillForm("  sample_project  ", "  우주를 여행하는 고양이  ");
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
  });

  it("sends no userId in the POST body and shows no userId field in the UI", async () => {
    const project = makeProject({ id: "sample_project", topic: "topic" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateProjectForm onCreated={() => {}} onCancel={() => {}} />);

    expect(screen.queryByLabelText(/userId/i)).toBeNull();

    fillForm("sample_project", "topic");
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("userId");
  });

  it("disables the submit button while submitting and lets only one rapid duplicate submit call fetch", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateProjectForm onCreated={() => {}} onCancel={() => {}} />);

    fillForm("sample_project", "topic");
    const submitButton = screen.getByRole("button", { name: "프로젝트 생성" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(201, { project: makeProject({ id: "sample_project", topic: "topic" }) }));
    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });

  it("shows a fixed safe error message (never the backend's own text) with its code identifiable via data-error-code, and does not call onCreated", async () => {
    vi.stubGlobal(
      "fetch",
      // The backend's own message is deliberately never shown — toDisplayError maps by code only.
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "PROJECT_ALREADY_EXISTS", message: "internal: duplicate project_id in learning_data/projects" })),
    );
    const onCreated = vi.fn();
    render(<CreateProjectForm onCreated={onCreated} onCancel={() => {}} />);

    fillForm("dup", "topic");
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    const alert = await screen.findByText("이미 같은 이름의 프로젝트가 있습니다.");
    expect(alert.closest('[role="alert"]')).toHaveAttribute("data-error-code", "PROJECT_ALREADY_EXISTS");
    expect(screen.queryByText(/internal:/)).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps the entered field values after a backend failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "PROJECT_ALREADY_EXISTS", message: "이미 존재하는 프로젝트입니다." })),
    );
    render(<CreateProjectForm onCreated={() => {}} onCancel={() => {}} />);

    fillForm("dup_project", "우주를 여행하는 고양이");
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("프로젝트 ID")).toHaveValue("dup_project");
    expect(screen.getByLabelText("영상 주제")).toHaveValue("우주를 여행하는 고양이");
  });

  it("calls onCancel when Cancel is clicked", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onCancel = vi.fn();
    render(<CreateProjectForm onCreated={() => {}} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
