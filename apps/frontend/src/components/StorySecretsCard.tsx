import { useEffect, useRef, useState } from "react";
import type { LongStoryBible, LongStoryBibleCollection, LongStoryBibleItem, LongStoryBibleItemInput } from "@ai-animation-studio/shared";

import { createLongStoryBibleItem, deleteLongStoryBibleItem, getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleItem } from "../api/longStoryBibleApi.js";

interface Props { projectId: string; }
type DisplayError = { code: string; message: string };
type Draft = { name: string; description: string; revealFrom: string };

/**
 * The two collections whose text actually reaches the model.
 *
 * A character's description is not sent anywhere — its linked picture is what the image step uses. A secret is
 * the opposite: the words ARE the item, and when they may be used is what keeps Episode 8's twist out of
 * Episode 3. That is why these two moved here with 세계관 while 캐릭터·배경·소품 did not.
 */
const LISTS: ReadonlyArray<{ collection: LongStoryBibleCollection; label: string; hint: string }> = [
  { collection: "secrets", label: "비밀", hint: "아직 밝혀지면 안 되는 것." },
  { collection: "foreshadowing", label: "복선", hint: "미리 깔아 두고 나중에 회수할 것." },
];

const EMPTY: Draft = { name: "", description: "", revealFrom: "" };

function itemInput(item: LongStoryBibleItem): LongStoryBibleItemInput {
  const { id: _id, ...input } = item;
  return input;
}

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallRemoveButton =
  "rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";

/**
 * 비밀·복선 — moved here from 등장인물·설정집.
 *
 * Same reason as 세계관: these describe the work, not a character, and script generation reads them from the
 * project once per prompt. Everything the old screen asked for besides these three fields (ID, 상태, 이미지
 * 연결) reached nothing for these two collections.
 */
export function StorySecretsCard({ projectId }: Props) {
  const [bible, setBible] = useState<LongStoryBible | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [validationError, setValidationError] = useState<{ collection: LongStoryBibleCollection; message: string } | null>(null);
  const [editing, setEditing] = useState<{ collection: LongStoryBibleCollection; itemId: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({ secrets: EMPTY, foreshadowing: EMPTY });
  const [deleteTarget, setDeleteTarget] = useState<{ collection: LongStoryBibleCollection; item: LongStoryBibleItem } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLongProjectStoryBible(projectId)
      .then(({ storyBible }) => { if (!cancelled) { setBible(storyBible); setError(null); } })
      .catch((caught: unknown) => { if (!cancelled) setError(toLongStoryBibleDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  function setDraft(collection: LongStoryBibleCollection, next: Draft): void {
    setDrafts((old) => ({ ...old, [collection]: next }));
    setValidationError(null);
  }
  function cancel(collection: LongStoryBibleCollection): void {
    setEditing(null); setDraft(collection, EMPTY);
  }

  async function submit(collection: LongStoryBibleCollection): Promise<void> {
    if (busy.current) return;
    const draft = drafts[collection] ?? EMPTY;
    if (!draft.name.trim()) { setValidationError({ collection, message: "이름을 입력하세요." }); return; }
    const revealFrom = Number(draft.revealFrom);
    const item = {
      name: draft.name.trim(),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      // Blank means "from Episode 1" on the server, so sending nothing says the same thing.
      ...(draft.revealFrom.trim() && Number.isInteger(revealFrom) && revealFrom >= 1 ? { revealAvailableEpisode: revealFrom } : {}),
    };
    setValidationError(null); busy.current = true; setPending(true);
    try {
      let response;
      if (editing && editing.collection === collection) {
        // Update replaces the whole item, so the stored one is merged under this card's three fields —
        // otherwise every field this card does not show would be cleared by editing a secret's wording.
        const stored = (bible?.[collection] ?? []).find((candidate) => candidate.id === editing.itemId);
        const merged: LongStoryBibleItemInput = { ...(stored ? itemInput(stored) : {}), ...item };
        // Clearing the box is a deliberate "from Episode 1", and the merge above would otherwise keep the old
        // number — the field would look cleared and not be.
        if (!draft.revealFrom.trim()) delete merged.revealAvailableEpisode;
        response = await updateLongStoryBibleItem(projectId, collection, editing.itemId, { item: merged });
      } else {
        response = await createLongStoryBibleItem(projectId, collection, { item });
      }
      setBible(response.storyBible); setError(null); setEditing(null); setDraft(collection, EMPTY);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const response = await deleteLongStoryBibleItem(projectId, deleteTarget.collection, deleteTarget.item.id);
      setBible(response.storyBible); setError(null); setDeleteTarget(null);
      if (editing?.itemId === deleteTarget.item.id) cancel(deleteTarget.collection);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  return (
    <section aria-label="비밀·복선" data-testid="story-secrets-card" className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <h3 className="text-base font-semibold text-slate-100">비밀·복선</h3>
      <p className="text-sm text-slate-400">적은 글이 대본에 <strong className="text-slate-300">그대로</strong> 전달됩니다.</p>
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
      {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
      {LISTS.map(({ collection, label, hint }) => {
        const items = bible?.[collection] ?? [];
        const draft = drafts[collection] ?? EMPTY;
        const editingHere = editing?.collection === collection;
        return (
          <div key={collection} className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3.5">
            <p className="text-sm font-medium text-slate-200">{label}</p>
            <p className="text-xs text-slate-500">{hint}</p>
            {bible && items.length === 0 && (
              <p data-testid={`story-secrets-empty-${collection}`} className="text-sm text-slate-400">
                아직 적은 {label}이 없습니다.
              </p>
            )}
            {items.length > 0 && (
              <ul aria-label={`${label} 목록`} className="space-y-2">
                {items.map((item) => (
                  <li key={item.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-slate-100">{item.name || item.id}</strong>
                      <span className="text-xs text-violet-300">
                        {item.revealAvailableEpisode === undefined ? "1화부터" : `${item.revealAvailableEpisode}화부터`}
                      </span>
                    </div>
                    {item.description && <p className="mt-1 text-sm text-slate-300">{item.description}</p>}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className={smallOutlineButton}
                        disabled={pending}
                        onClick={() => {
                          setEditing({ collection, itemId: item.id });
                          setDraft(collection, {
                            name: item.name ?? "",
                            description: item.description ?? "",
                            revealFrom: item.revealAvailableEpisode === undefined ? "" : String(item.revealAvailableEpisode),
                          });
                          setDeleteTarget(null);
                        }}
                      >
                        수정
                      </button>
                      <button type="button" className={smallRemoveButton} disabled={pending} onClick={() => setDeleteTarget({ collection, item })}>
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2 rounded-lg border border-violet-400/25 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-300">{editingHere ? `${label} 수정` : `${label} 추가`}</p>
              <label className="block text-xs text-slate-400">
                이름
                <input
                  aria-label={`${label} 이름`}
                  className={fieldClassName}
                  value={draft.name}
                  disabled={pending}
                  onChange={(event) => setDraft(collection, { ...draft, name: event.target.value })}
                />
              </label>
              <label className="block text-xs text-slate-400">
                내용
                <textarea
                  aria-label={`${label} 내용`}
                  rows={2}
                  className={fieldClassName}
                  value={draft.description}
                  disabled={pending}
                  onChange={(event) => setDraft(collection, { ...draft, description: event.target.value })}
                />
              </label>
              <label className="block text-xs text-slate-400">
                몇 화부터 써도 되나
                <input
                  aria-label={`${label} 공개 가능 회차`}
                  type="number"
                  min={1}
                  placeholder="1"
                  className={fieldClassName}
                  value={draft.revealFrom}
                  disabled={pending}
                  onChange={(event) => setDraft(collection, { ...draft, revealFrom: event.target.value })}
                />
                {/* The default is stated, because an empty box that silently means "from the first Episode" is
                    how a twist gets spoiled. One clause, not two sentences. */}
                <span className="mt-1 block text-xs text-slate-500">그 전 회차에는 쓰지 말라고 전달됩니다. 비우면 1화부터.</span>
              </label>
              {validationError?.collection === collection && (
                <p role="alert" data-testid={`story-secrets-validation-${collection}`} className="text-sm text-rose-400">{validationError.message}</p>
              )}
              <div className="flex gap-2">
                <button type="button" className={outlineButton} disabled={pending} onClick={() => void submit(collection)}>
                  {pending ? "저장하는 중..." : editingHere ? "변경 사항 저장" : `${label} 추가`}
                </button>
                {editingHere && (
                  <button type="button" className={outlineButton} disabled={pending} onClick={() => cancel(collection)}>
                    취소
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {deleteTarget && (
        <div role="alertdialog" aria-label="비밀·복선 삭제 확인" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm font-semibold text-amber-300">{deleteTarget.item.name || deleteTarget.item.id}을(를) 삭제할까요?</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={pending} onClick={() => setDeleteTarget(null)}>
              취소
            </button>
            <button
              type="button"
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={pending}
              onClick={() => void confirmDelete()}
            >
              {pending ? "삭제하는 중..." : "삭제"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
