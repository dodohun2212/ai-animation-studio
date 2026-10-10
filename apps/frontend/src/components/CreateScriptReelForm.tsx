import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { DEFAULT_SCENE_COUNT, MAX_SCENE_COUNT, MIN_SCENE_COUNT, type Project } from "@ai-animation-studio/shared";

import { createProject, toDisplayError } from "../api/projectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";
import { cardSectionWide as cardSection, outlineButton, primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}

/** 대본 칸의 한도 — 서버가 `initialStoryDraft.fullStory` 에 거는 선(6,000자)과 같습니다. */
export const SCRIPT_TEXT_LIMIT = 6000;
/** 불러올 파일의 크기 한도. 6,000자는 UTF-8 로 많아야 18KB 남짓이라, 그보다 훨씬 큰 파일은 대본이 아니라고 보고 읽지 않습니다. */
export const SCRIPT_FILE_MAX_BYTES = 64 * 1024;
const SCRIPT_FILE_EXTENSIONS = [".txt", ".md"] as const;

/** 대본 AI 에게 「이건 사람이 쓴 대본」이라고 알리는 메모 — 장면을 나눌 때 순서·대사·행동을 바꾸지 말라고. */
export const SCRIPT_NOTES = "【사용자 대본】 위 전체 줄거리는 사용자가 직접 쓰거나 파일에서 불러온 대본입니다. 장면을 나눌 때 대본의 순서·대사·핵심 행동을 바꾸지 말고, 화면에 필요한 세부(장소·구도·움직임)만 채우십시오.";

const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

/** 파일 하나를 문자열로 — 브라우저 안에서만 읽고 어디에도 올리지 않습니다. 앞의 BOM 은 뗍니다. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^﻿/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file, "utf-8");
  });
}

/** 불러오기 전에 막을 이유 — 확장자와 크기. 통과하면 null. */
export function scriptFileProblem(file: { name: string; size: number }): string | null {
  const lower = file.name.toLowerCase();
  if (!SCRIPT_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return ".txt 또는 .md 파일만 불러올 수 있습니다.";
  if (file.size > SCRIPT_FILE_MAX_BYTES) return `파일이 너무 큽니다(${Math.ceil(file.size / 1024).toLocaleString("ko-KR")}KB). 대본은 ${SCRIPT_TEXT_LIMIT.toLocaleString("ko-KR")}자까지라 ${SCRIPT_FILE_MAX_BYTES / 1024}KB 이하의 파일만 읽습니다.`;
  return null;
}

/**
 * 「대본으로 시작」(CLI 1348) — 가지고 있는 대본을 붙여넣거나 .txt/.md 로 불러와 단기 프로젝트(릴스)를 만듭니다.
 *
 * 🔴 꽃말 서식과 같은 이유로 이 화면은 장면을 직접 쓰지 않습니다. 이미지·영상 프롬프트가 읽는 장면 필드 열일곱 개는 대본
 * 생성만 채우므로(CLI Round 609), 사람의 대본은 `initialStoryDraft.fullStory` 로 넣고 기존 흐름의 대본 생성(비용 확인 →
 * 승인)이 그 대본을 장면으로 나눕니다. 결과는 대본 검토 화면에서 확인·수정합니다.
 * 🔴 파일은 이 브라우저 안에서만 읽어 칸에 보여 줄 뿐 올리지도 저장하지도 않고, 불러오기만으로는 아무 요청도 나가지 않습니다.
 * 프로젝트는 대본이 화면에 보이는 상태에서 「대본으로 프로젝트 만들기」를 눌러야 만들어지고, 이 화면은 Provider 를 부르지 않습니다.
 */
export function CreateScriptReelForm({ onCreated, onCancel }: Props) {
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [character, setCharacter] = useState("");
  const [script, setScript] = useState("");
  const [sceneCount, setSceneCount] = useState<number>(DEFAULT_SCENE_COUNT);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const overLimit = script.length > SCRIPT_TEXT_LIMIT;
  const sceneValid = Number.isInteger(sceneCount) && sceneCount >= MIN_SCENE_COUNT && sceneCount <= MAX_SCENE_COUNT;

  async function loadFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    setFileNotice(null);
    setFileError(null);
    if (!file) return;
    const problem = scriptFileProblem(file);
    if (problem) { setFileError(problem); return; }
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setFileError("파일을 읽지 못했습니다. 다른 파일을 고르거나 내용을 직접 붙여넣어 주세요.");
      return;
    }
    if (!text.trim()) { setFileError("파일이 비어 있습니다."); return; }
    setScript(text);
    if (!projectName.trim()) setProjectName(file.name.replace(/\.(txt|md)$/i, "").slice(0, 100));
    // UTF-8 이 아닌 파일(예: 메모장의 ANSI/CP949)은 깨진 글자(�)로 읽힙니다 — 숨기지 않고 말합니다.
    const broken = text.includes("�");
    setFileNotice(`「${file.name}」을(를) 불러왔습니다(${text.length.toLocaleString("ko-KR")}자). 아래 칸에서 고칠 수 있습니다.${broken ? " 깨진 글자(�)가 보이면 파일을 UTF-8로 저장한 뒤 다시 불러와 주세요." : ""}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) return;
    const trimmedId = projectId.trim();
    const trimmedName = projectName.trim();
    const trimmedScript = script.trim();
    let problem: string | null = null;
    if (!trimmedId) problem = "폴더 이름을 입력하세요.";
    else if (!isSafeProjectId(trimmedId)) problem = "폴더 이름에는 한글, 영문, 숫자와 '_', '-'만 쓸 수 있습니다. 띄어쓰기는 쓸 수 없습니다.";
    else if (!trimmedName) problem = "프로젝트 이름을 입력하세요.";
    else if (!trimmedScript) problem = "대본을 붙여넣거나 파일에서 불러와 주세요.";
    else if (overLimit) problem = `대본이 ${SCRIPT_TEXT_LIMIT.toLocaleString("ko-KR")}자를 넘습니다. 줄여 주세요.`;
    else if (!sceneValid) problem = `장면 수는 ${MIN_SCENE_COUNT}–${MAX_SCENE_COUNT} 사이의 정수입니다.`;
    setFieldError(problem);
    if (problem) return;

    setSubmitError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await createProject({
        projectId: trimmedId,
        topic: trimmedName,
        initialStoryDraft: { projectName: trimmedName, character: character.trim(), fullStory: trimmedScript, additionalNotes: SCRIPT_NOTES, sceneCount },
      });
      onCreated(response.project);
    } catch (caught) {
      setSubmitError(toDisplayError(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form data-testid="script-reel-form" className={`mt-5 max-w-3xl ${cardSection}`} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="scriptProjectId">폴더 이름</label>
        <p id="scriptProjectId-hint" className="mt-1 text-xs text-slate-500">이 이름으로 컴퓨터에 프로젝트 폴더가 만들어집니다. 한글·영문·숫자와 _ - 를 쓸 수 있고 띄어쓰기는 쓸 수 없습니다.</p>
        <input id="scriptProjectId" data-testid="script-project-id" aria-describedby="scriptProjectId-hint" className={field} value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={submitting} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-sm text-slate-300" htmlFor="scriptProjectName">프로젝트 이름</label>
          <input id="scriptProjectName" data-testid="script-project-name" className={field} value={projectName} maxLength={100} onChange={(event) => setProjectName(event.target.value)} disabled={submitting} />
        </div>
        <div>
          <label className="block text-sm text-slate-300" htmlFor="scriptCharacter">주인공 (선택)</label>
          <input id="scriptCharacter" data-testid="script-character" className={field} value={character} maxLength={100} onChange={(event) => setCharacter(event.target.value)} disabled={submitting} placeholder="예: 토리" />
        </div>
      </div>
      <div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm text-slate-300" htmlFor="scriptText">대본</label>
          <button type="button" data-testid="script-file-open" className={`${smallOutlineButton} ml-auto`} onClick={() => fileInput.current?.click()} disabled={submitting}>
            파일에서 불러오기 (.txt · .md)
          </button>
          <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" data-testid="script-file" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void loadFile(event)} />
        </div>
        {fileNotice && <p role="status" data-testid="script-file-notice" className="mt-1 text-xs text-emerald-300">{fileNotice}</p>}
        {fileError && <p role="alert" data-testid="script-file-error" className="mt-1 text-xs text-rose-400">{fileError}</p>}
        <textarea
          id="scriptText"
          data-testid="script-text"
          className={`${field} min-h-56 leading-relaxed`}
          value={script}
          onChange={(event) => setScript(event.target.value)}
          disabled={submitting}
          aria-invalid={overLimit}
          aria-describedby="scriptText-count"
          placeholder="대본을 붙여넣거나 위에서 파일을 불러오세요. 장면 구분이 없어도 됩니다."
        />
        <p id="scriptText-count" data-testid="script-count" className={`mt-1 text-xs tabular-nums ${overLimit ? "text-rose-400" : "text-slate-500"}`}>
          {script.length.toLocaleString("ko-KR")} / {SCRIPT_TEXT_LIMIT.toLocaleString("ko-KR")}자{overLimit ? " — 너무 깁니다. 줄여 주세요." : ""}
        </p>
      </div>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="scriptScenes">장면 수 ({MIN_SCENE_COUNT}–{MAX_SCENE_COUNT})</label>
        <input id="scriptScenes" data-testid="script-scenes" type="number" min={MIN_SCENE_COUNT} max={MAX_SCENE_COUNT} className={`${field} w-28`} value={sceneCount} onChange={(event) => setSceneCount(Number(event.target.value))} disabled={submitting} />
      </div>
      <p data-testid="script-next-steps" className="border-l-2 border-amber-400/40 pl-3 text-xs leading-relaxed text-slate-400">
        파일을 불러오거나 붙여넣는 것만으로는 아무것도 보내지 않습니다. 만들면 프로젝트 설정으로 이어지고, 다음 단계의 대본 만들기에서 AI가 이 대본을 장면 수만큼 나눕니다 — 비용을 확인하고 승인해야 시작되며, 나뉜 대본은 대본 검토 화면에서 확인·수정합니다.
      </p>
      {fieldError && <p role="alert" data-testid="script-field-error" className="text-sm text-rose-400">{fieldError}</p>}
      {submitError && <p role="alert" data-testid="script-submit-error" data-error-code={submitError.code} className="text-sm text-rose-400">{submitError.message}</p>}
      <div className="flex gap-3 pt-1">
        <button type="submit" data-testid="script-submit" className={primaryButton} disabled={submitting || overLimit}>
          {submitting ? "만드는 중..." : "대본으로 프로젝트 만들기"}
        </button>
        <button type="button" className={outlineButton} onClick={onCancel} disabled={submitting}>취소</button>
      </div>
    </form>
  );
}
