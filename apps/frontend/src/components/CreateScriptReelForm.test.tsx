import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { CreateProjectForm } from "./CreateProjectForm.js";
import { CreateScriptReelForm, SCRIPT_FILE_MAX_BYTES, SCRIPT_NOTES, SCRIPT_TEXT_LIMIT, scriptFileProblem } from "./CreateScriptReelForm.js";

const SCRIPT = "1. 토리가 알람을 끈다.\n2. 「오늘은 꼭 일찍 가야 해!」\n3. 문을 열자 비가 쏟아진다.";

function renderForm() {
  const onCreated = vi.fn();
  render(<CreateScriptReelForm onCreated={onCreated} onCancel={() => {}} />);
  return { onCreated };
}

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function chooseFile(file: File) {
  fireEvent.change(screen.getByTestId("script-file"), { target: { files: [file] } });
}

describe("scriptFileProblem", () => {
  it("accepts .txt and .md only, up to the size limit", () => {
    expect(scriptFileProblem({ name: "대본.TXT", size: 10 })).toBeNull();
    expect(scriptFileProblem({ name: "script.md", size: SCRIPT_FILE_MAX_BYTES })).toBeNull();
    expect(scriptFileProblem({ name: "script.docx", size: 10 })).toContain(".txt 또는 .md");
    expect(scriptFileProblem({ name: "script.txt", size: SCRIPT_FILE_MAX_BYTES + 1 })).toContain("너무 큽니다");
  });
});

describe("CreateScriptReelForm", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** 🔴 붙여넣은 대본이 그대로 `initialStoryDraft.fullStory` 로 — 누르기 전에는 아무 요청도 없고, Provider 경로도 없다. */
  it("creates a short project from a pasted script exactly as shown, only on the button", async () => {
    const project = makeProject({ id: "비오는_아침" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = renderForm();

    fill("script-project-id", "비오는_아침");
    fill("script-project-name", "비 오는 아침");
    fill("script-character", " 토리 ");
    fill("script-text", `  ${SCRIPT}  `);
    fill("script-scenes", "3");
    expect(screen.getByTestId("script-count").textContent).toContain(`/ ${SCRIPT_TEXT_LIMIT.toLocaleString("ko-KR")}자`);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("script-submit"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/projects");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      projectId: "비오는_아침",
      topic: "비 오는 아침",
      initialStoryDraft: { projectName: "비 오는 아침", character: "토리", fullStory: SCRIPT, additionalNotes: SCRIPT_NOTES, sceneCount: 3 },
    });
    expect(screen.getByTestId("script-next-steps").textContent).toContain("승인해야 시작");
  });

  /** 파일은 이 브라우저 안에서만 읽어 칸에 보여 준다 — 불러오기만으로는 요청이 없고, 이름이 비어 있으면 파일 이름으로 채운다. */
  it("reads a .md file into the editable field without sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    chooseFile(new File([`﻿${SCRIPT}`], "비 오는 아침.md", { type: "text/markdown" }));
    await waitFor(() => expect((screen.getByTestId("script-text") as HTMLTextAreaElement).value).toBe(SCRIPT));
    expect(screen.getByTestId("script-file-notice").textContent).toContain("「비 오는 아침.md」");
    expect((screen.getByTestId("script-project-name") as HTMLInputElement).value).toBe("비 오는 아침");
    fill("script-text", `${SCRIPT}\n4. 우산을 편다.`);
    expect((screen.getByTestId("script-text") as HTMLTextAreaElement).value).toContain("우산을 편다");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a wrong file type, an oversized file and an empty file before reading or sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    chooseFile(new File(["x"], "script.docx"));
    expect((await screen.findByTestId("script-file-error")).textContent).toContain(".txt 또는 .md");
    chooseFile(new File(["가".repeat(SCRIPT_FILE_MAX_BYTES)], "big.txt"));
    await waitFor(() => expect(screen.getByTestId("script-file-error").textContent).toContain("너무 큽니다"));
    chooseFile(new File(["   "], "empty.txt"));
    await waitFor(() => expect(screen.getByTestId("script-file-error").textContent).toContain("비어 있습니다"));
    expect((screen.getByTestId("script-text") as HTMLTextAreaElement).value).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads a long file for trimming but will not create over the limit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    chooseFile(new File(["가".repeat(SCRIPT_TEXT_LIMIT + 1)], "long.txt"));
    await waitFor(() => expect(screen.getByTestId("script-count").textContent).toContain("너무 깁니다"));
    expect((screen.getByTestId("script-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("script-text").getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what is missing before sending: folder, name, script and scene count", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    fireEvent.click(screen.getByTestId("script-submit"));
    expect((await screen.findByTestId("script-field-error")).textContent).toBe("폴더 이름을 입력하세요.");
    fill("script-project-id", "has space");
    fireEvent.click(screen.getByTestId("script-submit"));
    expect(screen.getByTestId("script-field-error").textContent).toContain("띄어쓰기");
    fill("script-project-id", "ok_id");
    fireEvent.click(screen.getByTestId("script-submit"));
    expect(screen.getByTestId("script-field-error").textContent).toBe("프로젝트 이름을 입력하세요.");
    fill("script-project-name", "이름");
    fireEvent.click(screen.getByTestId("script-submit"));
    expect(screen.getByTestId("script-field-error").textContent).toContain("대본을 붙여넣거나");
    fill("script-text", SCRIPT);
    fill("script-scenes", "13");
    fireEvent.click(screen.getByTestId("script-submit"));
    expect(screen.getByTestId("script-field-error").textContent).toContain("2–12");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as a fixed sentence and keeps the script", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "PROJECT_ALREADY_EXISTS", message: "raw" })));
    renderForm();
    fill("script-project-id", "dup");
    fill("script-project-name", "이름");
    fill("script-text", SCRIPT);
    fireEvent.click(screen.getByTestId("script-submit"));
    const alert = await screen.findByTestId("script-submit-error");
    expect(alert.textContent).not.toContain("raw");
    expect((screen.getByTestId("script-text") as HTMLTextAreaElement).value).toBe(SCRIPT);
  });

  /** 새 프로젝트 화면의 세 번째 시작 방법 — 화살표로도 닿는다. 기존 두 선택지는 그대로. */
  it("is offered as the third start choice on the new project screen", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreateProjectForm onCreated={() => {}} onCancel={() => {}} />);
    const flower = screen.getByTestId("create-source-flower");
    fireEvent.click(flower);
    fireEvent.keyDown(flower, { key: "ArrowRight" });
    expect(screen.getByTestId("create-source-script")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("script-reel-form")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("create-source-script"), { key: "Home" });
    expect(screen.getByTestId("create-source-ai")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("영상 주제")).toBeTruthy();
  });
});
