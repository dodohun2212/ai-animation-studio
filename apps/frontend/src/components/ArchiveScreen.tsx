import { useEffect, useRef, useState } from "react";
import type { ArchivedLongProjectSummary, ArchivedProjectSummary } from "@ai-animation-studio/shared";

import {
  deleteArchivedLongProject,
  deleteArchivedProject,
  listArchivedLongProjects,
  listArchivedProjects,
  restoreLongProject,
  restoreProject,
  toArchiveDisplayError,
} from "../api/archiveApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { Spinner } from "./Spinner.js";

interface Props {
  onBack: () => void;
  /** Called after a successful restore or permanent delete, so active project lists can refresh. */
  onChanged?: () => void;
}

type DisplayError = { code: string; message: string };

/** One pending action awaiting its in-screen confirmation — nothing is sent until the panel's final button. */
type PendingAction = { kind: "restore" | "delete"; scope: "short" | "long"; id: string; label: string };

const outlineButton =
  "rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-medium text-slate-200 shadow-sm hover:border-white/30 hover:bg-white/10 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-200 hover:border-white/30 hover:bg-white/10 disabled:opacity-50";
const smallDangerButton =
  "rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300 hover:border-rose-400/60 hover:bg-rose-500/15 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2.5 text-base font-semibold">
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
      />
      {children}
    </h3>
  );
}

export function ArchiveScreen({ onBack, onChanged }: Props) {
  const [shortProjects, setShortProjects] = useState<ArchivedProjectSummary[] | null>(null);
  const [longProjects, setLongProjects] = useState<ArchivedLongProjectSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<DisplayError | null>(null);
  const loadRequest = useRef(0);
  const actionBusy = useRef(false);

  async function load() {
    const requestId = ++loadRequest.current;
    setLoading(true);
    try {
      const [shortResponse, longResponse] = await Promise.all([listArchivedProjects(), listArchivedLongProjects()]);
      if (requestId !== loadRequest.current) return;
      setShortProjects(shortResponse.projects);
      setLongProjects(longResponse.projects);
      setListError(null);
    } catch (caught) {
      if (requestId !== loadRequest.current) return;
      setListError(toArchiveDisplayError(caught));
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAction(action: PendingAction): void {
    setPending(action);
    setDeleteConfirmation("");
    setActionError(null);
  }

  function cancelAction(): void {
    if (actionPending) return;
    setPending(null);
    setDeleteConfirmation("");
  }

  async function confirmAction(): Promise<void> {
    if (!pending || actionBusy.current) return;
    if (pending.kind === "delete" && deleteConfirmation !== pending.label) return;
    actionBusy.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      if (pending.kind === "restore") {
        await (pending.scope === "short" ? restoreProject(pending.id) : restoreLongProject(pending.id));
      } else if (pending.scope === "short") {
        await deleteArchivedProject(pending.id, { confirmation: deleteConfirmation });
      } else {
        await deleteArchivedLongProject(pending.id, { confirmation: deleteConfirmation });
      }
      setPending(null);
      setDeleteConfirmation("");
      onChanged?.();
      await load();
    } catch (caught) {
      setActionError(toArchiveDisplayError(caught));
    } finally {
      actionBusy.current = false;
      setActionPending(false);
    }
  }

  function renderRow(scope: "short" | "long", id: string, label: string, archivedAt: string, extra: string) {
    const displayLabel = label || id;
    return (
      <li key={id} data-testid={`archived-${scope}-${id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm text-slate-100">{displayLabel}</strong>
          <span className="text-xs text-slate-400 tabular-nums" title={archivedAt}>
            {extra} · 보관 시각: {formatDateTime(archivedAt)}
          </span>
        </span>
        <button
          type="button"
          data-testid={`archived-restore-${id}`}
          className={smallOutlineButton}
          disabled={actionPending}
          onClick={() => openAction({ kind: "restore", scope, id, label })}
        >
          복구
        </button>
        <button
          type="button"
          data-testid={`archived-delete-${id}`}
          className={smallDangerButton}
          disabled={actionPending}
          onClick={() => openAction({ kind: "delete", scope, id, label })}
        >
          완전히 삭제
        </button>
      </li>
    );
  }

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <header className="flex items-center justify-between">
        <button type="button" className={outlineButton} onClick={onBack}>
          프로젝트 목록으로
        </button>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          보관함
        </h1>
      </header>
      <p className="text-sm text-slate-400">
        보관한 프로젝트는 데이터가 그대로 남아 있어 언제든 "복구"로 다시 꺼낼 수 있습니다. "완전히 삭제"는 파일까지 진짜로
        지우는 되돌릴 수 없는 동작이라, 프로젝트의 주제/제목을 정확히 입력해야만 실행됩니다.
      </p>

      {loading && !shortProjects && !longProjects && <Spinner label="보관함을 불러오는 중..." />}
      {listError && (
        <p role="alert" data-testid="archive-list-error" data-error-code={listError.code} className="text-sm text-rose-400">
          {listError.message}
        </p>
      )}

      {shortProjects && (
        <section aria-label="보관된 단편 프로젝트" className={cardSection}>
          <SectionHeading>단편 프로젝트</SectionHeading>
          {shortProjects.length === 0 && <p className="text-sm text-slate-400">보관된 단편 프로젝트가 없습니다.</p>}
          {shortProjects.length > 0 && (
            <ul aria-label="보관된 단편 프로젝트 목록" className="space-y-2">
              {shortProjects.map((project) => renderRow("short", project.id, project.topic, project.archivedAt, project.id))}
            </ul>
          )}
        </section>
      )}

      {longProjects && (
        <section aria-label="보관된 장기 프로젝트" className={cardSection}>
          <SectionHeading>장기 프로젝트</SectionHeading>
          {longProjects.length === 0 && <p className="text-sm text-slate-400">보관된 장기 프로젝트가 없습니다.</p>}
          {longProjects.length > 0 && (
            <ul aria-label="보관된 장기 프로젝트 목록" className="space-y-2">
              {longProjects.map((project) => renderRow("long", project.id, project.title, project.archivedAt, `에피소드 ${project.episodeCount}개`))}
            </ul>
          )}
        </section>
      )}

      {pending && pending.kind === "restore" && (
        <div
          role="alertdialog"
          aria-label="복구 확인"
          data-testid="archive-restore-confirm"
          className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
        >
          <p className="text-sm text-slate-200">
            '{pending.label || pending.id}' 프로젝트를 보관함에서 꺼내 다시 활성 목록으로 되돌릴까요?
          </p>
          {actionError && (
            <p role="alert" data-testid="archive-action-error" data-error-code={actionError.code} className="text-sm text-rose-400">
              {actionError.message}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" className={outlineButton} onClick={cancelAction} disabled={actionPending}>
              취소
            </button>
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
              onClick={() => void confirmAction()}
              disabled={actionPending}
            >
              {actionPending ? "복구하는 중…" : "복구하기"}
            </button>
          </div>
        </div>
      )}

      {pending && pending.kind === "delete" && (
        <div
          role="alertdialog"
          aria-label="완전 삭제 확인"
          data-testid="archive-delete-confirm"
          className="space-y-3 rounded-xl border border-rose-400/40 bg-rose-950/20 p-4"
        >
          <p className="text-sm font-semibold text-rose-200">'{pending.label || pending.id}' 프로젝트를 완전히 삭제할까요?</p>
          <p className="text-sm text-slate-300">
            이미지·영상을 포함한 모든 파일이 디스크에서 지워지며, 이 작업은 되돌릴 수 없습니다. 계속하려면 아래에 정확히 입력하세요:
            <span className="ml-1 font-semibold text-slate-100">{pending.label}</span>
          </p>
          <label className="block text-sm text-slate-200" htmlFor="archive-delete-confirmation">
            위 내용 그대로 입력
          </label>
          <input
            id="archive-delete-confirmation"
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 focus:border-rose-400/50 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-50"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            disabled={actionPending}
          />
          {actionError && (
            <p role="alert" data-testid="archive-action-error" data-error-code={actionError.code} className="text-sm text-rose-400">
              {actionError.message}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" className={outlineButton} onClick={cancelAction} disabled={actionPending}>
              취소
            </button>
            <button
              type="button"
              data-testid="archive-delete-proceed"
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(225,29,72,0.3)] disabled:opacity-50"
              onClick={() => void confirmAction()}
              disabled={actionPending || deleteConfirmation !== pending.label}
            >
              {actionPending ? "삭제하는 중…" : "완전히 삭제"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
