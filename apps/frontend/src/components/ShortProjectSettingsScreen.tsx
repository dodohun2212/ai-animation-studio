import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  type Asset,
  type AssetType,
  type ShortProjectCastMember,
  type ShortProjectContinuityOption,
  type ShortProjectSceneReferenceAsset,
  type ShortProjectSettings,
} from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import {
  getProjectAssetReferences, getProjectCast, getProjectContinuity, getProjectSettings, listProjectContinuityOptions, setProjectContinuity, toDisplayError,
  updateProjectAssetReferences, updateProjectCast, updateProjectSettings,
} from "../api/projectsApi.js";
import { createStoryPromptDraftPreview, toStoryDisplayError } from "../api/storyPromptApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; onBack: () => void; justCreated?: boolean; }
type State = {
  settings: ShortProjectSettings | null;
  loading: boolean;
  error: { code: string; message: string } | null;
  /**
   * Whether each of these two can still be changed, straight from the server.
   *
   * Deriving them here — "does the project have scenes yet" — would be a second copy of the condition the save
   * itself checks, and two copies is how the continuity screen came to disagree with its own server. They are
   * two flags and not one because the conditions are independent: a project can have images and no Story (the
   * Story was regenerated), and there the scene count is still editable.
   *
   * Default true while loading, so a slow read never makes a working field look permanently locked; nothing is
   * saveable until the settings arrive anyway.
   */
  sceneCountChangeable: boolean;
  aspectRatioChangeable: boolean;
};

const EMPTY_SETTINGS: ShortProjectSettings = {
  projectName: "", topic: "", genre: "미스터리", mood: "시네마틱", character: "", lore: "", fullStory: "",
  durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "", styleNotes: { aspect: "16:9" },
  narrationEnabled: false, subtitlesEnabled: false,
};

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const inlineInput =
  "rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const dangerOutlineButton =
  "rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAddButton =
  "rounded-full border border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50";
const smallRemoveButton =
  "rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

/**
 * "This section saves on every click."
 *
 * This screen has two save models: the form at the top waits for its button, the three sections below persist
 * on every change. That was stated once, in small text, at the very bottom of a long page — after all three
 * sections. Someone who edits the top and leaves loses the edit, and the sentence that would have warned them
 * is below the fold. A rule about a section belongs on the section.
 */
function AutoSaveTag() {
  return (
    <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-normal text-emerald-300">
      고치면 바로 저장
    </span>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
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

/** The two shapes the video step can actually produce, in the spelling its ratio check compares against. */
const ASPECT_OPTIONS: { value: string; label: string }[] = [
  { value: "9:16", label: "세로형 9:16" },
  { value: "16:9", label: "가로형 16:9" },
];

/**
 * Screen shape, as a choice rather than a free-text note.
 *
 * The backend decides orientation with `aspect === "16:9" ? landscape : portrait` (video-preview.service.ts),
 * so anything else — a typo, "1920x1080", Korean, an empty box — silently produces a vertical video. Typing it
 * by hand meant a project could look landscape in settings and bill six vertical clips. A stored value that is
 * neither option is kept and named rather than quietly rewritten: replacing the user's data on render would
 * hide that their old project is about to come out vertical.
 */
function AspectField({ value, onChange, changeable }: { value: string; onChange: (value: string) => void; changeable: boolean }) {
  const known = ASPECT_OPTIONS.some((option) => option.value === value);
  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-slate-300" htmlFor="settings-aspect">
        화면 비율
        <select
          id="settings-aspect"
          data-testid="settings-aspect"
          className={fieldClassName}
          value={known ? value : ""}
          disabled={!changeable}
          onChange={(event) => onChange(event.target.value)}
        >
          {!known && <option value="">{value ? `인식할 수 없는 값: ${value}` : "선택 안 됨"}</option>}
          {ASPECT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {/* Named before the unknown-value warning, because it is the stronger fact: if the ratio cannot change,
          "고르면 바뀝니다" is not true any more. This repository has already shipped the bug this lock exists
          for — images made portrait, video billed landscape, the merge padding the mismatch. */}
      {!changeable && (
        <p data-testid="settings-aspect-locked" className="text-xs text-amber-300">
          이미 지금 비율로 이미지를 만들어서 비율은 바꿀 수 없습니다. 바꾸려면 이미지를 다시 만들어야 합니다.
        </p>
      )}
      {!known && changeable && (
        <p data-testid="settings-aspect-unknown" className="text-xs text-amber-300">
          지금 값으로는 세로형으로 만들어집니다. 위에서 하나를 고르면 바뀝니다.
        </p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {multiline ? (
        <textarea className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

/**
 * The two spellings the backend itself treats as the representative — `describeCharacterCast()` in
 * story-asset-metadata.ts decides "대표 캐릭터" vs "서브 캐릭터" by exactly this test. The screen used to offer a
 * free-text 배역 box, so anything typed in Korean fell through to 서브 and the distinction never reached the
 * prompt. Reading the same rule here is what makes the toggle below mean what it says.
 */
function isRepresentative(member: ShortProjectCastMember): boolean {
  return member.castRole === "protagonist" || member.castRole === "lead";
}

/**
 * `storyRole` is free text the user may have written themselves ("복수를 노리는 동생"). Promoting or demoting a
 * member rewrites it only when it still holds one of the two values this screen fills in automatically —
 * never when it holds something a person typed.
 */
const AUTO_STORY_ROLES = new Set(["대표 캐릭터", "서브 캐릭터", ""]);

/**
 * Wizard-time representative/supporting Character Asset selection (Python's `character_profile.cast`). Saves
 * through its own endpoint, separate from the plain-text settings form above, so a search or a blur-save here
 * never depends on the settings form's own save state.
 */
function CastEditor({ projectId, onLeadNameChange }: { projectId: string; onLeadNameChange: (name: string | null) => void }) {
  const [cast, setCast] = useState<ShortProjectCastMember[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[] | null>(null);
  /**
   * assetId -> display name, for the selected list. The cast contract stores only ids, so a name has to come
   * from somewhere: every search result and every freshly added member contributes one. An id with no known
   * name (a member saved in an earlier session, before any search ran) falls back to showing the id rather
   * than showing nothing.
   */
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  /**
   * Whether the folder list has been read, so an unresolved id can be told apart from one not looked up yet.
   *
   * Without this the screen cannot say the difference between "still loading" and "that folder is gone", and
   * both looked identical: a bare id in the row you press 대표 on.
   */
  const [namesLoaded, setNamesLoaded] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<{ code: string; message: string } | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getProjectCast(projectId).then((response) => { if (!cancelled) setCast(response.cast); })
      .catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    /* Names for the cast that is already saved.
       `memberNames` used to be filled only by searching or adding, both of which happen in this session — so
       reopening the screen listed every saved character by its raw id ("FOLDER-C91BA4DC1ECB") until the person
       happened to run a search that returned it. The id is not a name, and the row it labels is the one you
       press 대표 on. Failure is silent on purpose: the ids still render, exactly as before. */
    listAssets({ assetType: "character" })
      .then((response) => {
        if (cancelled) return;
        setMemberNames((current) => ({
          ...Object.fromEntries(response.assets.map((asset) => [asset.assetId, asset.displayName])),
          ...current,
        }));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNamesLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSearchLoading(true); setSearchError(null);
    try {
      const response = await listAssets({ query: query || undefined, assetType: "character" });
      /* Folders only. A loose image is one drawing of a character, not the character — and the prompt's
         per-child description block (describeCharacterCast's `하위 이미지별 개별 특징`) has nothing to say
         unless the cast member is a Folder. Filtering here keeps the /assets contract untouched. */
      const folders = response.assets.filter((asset) => asset.isFolder);
      setResults(folders);
      setMemberNames((current) => ({
        ...current,
        ...Object.fromEntries(folders.map((asset) => [asset.assetId, asset.displayName])),
      }));
    } catch (caught) { setSearchError(toAssetDisplayError(caught)); }
    finally { setSearchLoading(false); }
  }

  /**
   * The name the prompt will actually use for 대표 캐릭터, or null when this list names no lead.
   *
   * The server resolves it as `castLeadName ?? settings.character` (story-prompt.service.ts): a lead here wins
   * over the free-text field in the form above, and nothing on screen said so — a name typed there was
   * silently dropped the moment a folder was marked 대표. The form needs this value to say which one is live,
   * so it is lifted rather than kept private.
   */
  useEffect(() => {
    const lead = (cast ?? []).find(isRepresentative);
    if (!lead) { onLeadNameChange(null); return; }
    onLeadNameChange(memberNames[lead.assetId] ?? null);
  }, [cast, memberNames, onLeadNameChange]);

  async function persist(next: ShortProjectCastMember[]): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const response = await updateProjectCast(projectId, { cast: next });
      setCast(response.cast);
    } catch (caught) { setError(toDisplayError(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function addMember(asset: Asset): void {
    if (!cast || cast.some((member) => member.assetId === asset.assetId)) return;
    setMemberNames((current) => ({ ...current, [asset.assetId]: asset.displayName }));
    void persist([...cast, { assetId: asset.assetId, castRole: "supporting", storyRole: "서브 캐릭터" }]);
  }
  function removeMember(assetId: string): void {
    if (!cast) return;
    void persist(cast.filter((member) => member.assetId !== assetId));
  }
  /** Exactly one representative: promoting one demotes every other member in the same save. */
  function setRepresentative(assetId: string): void {
    if (!cast) return;
    void persist(cast.map((member) => {
      const representative = member.assetId === assetId;
      return {
        ...member,
        castRole: representative ? "protagonist" : "supporting",
        storyRole: AUTO_STORY_ROLES.has(member.storyRole.trim()) ? (representative ? "대표 캐릭터" : "서브 캐릭터") : member.storyRole,
      };
    }));
  }
  /** Demoting the current representative leaves none — the hint below says so rather than silently picking one. */
  function setSupporting(assetId: string): void {
    if (!cast) return;
    void persist(cast.map((member) => member.assetId !== assetId ? member : {
      ...member,
      castRole: "supporting",
      storyRole: AUTO_STORY_ROLES.has(member.storyRole.trim()) ? "서브 캐릭터" : member.storyRole,
    }));
  }
  function updateMember(assetId: string, key: "castRole" | "storyRole", value: string): void {
    if (!cast) return;
    setCast(cast.map((member) => member.assetId === assetId ? { ...member, [key]: value } : member));
  }
  function saveMember(assetId: string): void {
    if (!cast) return;
    const member = cast.find((item) => item.assetId === assetId);
    if (!member || !member.castRole.trim() || !member.storyRole.trim()) return;
    void persist(cast);
  }

  return (
    <section aria-label="등장 캐릭터" className={cardSection}>
      <SectionHeading>등장 캐릭터 <AutoSaveTag /></SectionHeading>
      <p className="text-xs text-slate-400">
        대표는 한 명, 나머지는 모두 서브 캐릭터가 됩니다. 이 구분은 대본 AI에게 그대로 전달됩니다.
        캐릭터형 <strong className="text-slate-300">폴더</strong>만 고를 수 있습니다 — 낱장 이미지 하나는 캐릭터가 아니라 그림 한 장이라서요.
      </p>
      {error && (
        <p role="alert" data-testid="cast-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {cast === null && !error && <Spinner label="불러오는 중..." />}
      {cast && cast.length === 0 && <p className="text-sm text-slate-400">선택된 캐릭터가 없습니다.</p>}
      {cast && cast.length > 0 && (
        <ul aria-label="선택된 캐릭터 목록" className="space-y-2">
          {cast.map((member) => (
            <li key={member.assetId} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
              {/* Was the raw asset id (ASSET-CHARACTER-000000000001). Nobody can tell who they added from that.
                  The name comes from whichever search result was clicked; the id stays as the title attribute
                  so it is still recoverable when something needs to be matched up by hand. */}
              {/* A cast row can outlive the folder it points at — the folder is deleted in the library and
                  nothing here notices. It used to render the raw id, which reads as a glitch rather than as
                  "this one is gone, remove it". */}
              <span className="text-sm font-medium text-slate-200" title={member.assetId}>
                {memberNames[member.assetId]
                  ?? (namesLoaded
                    ? <span data-testid={`cast-missing-${member.assetId}`} className="text-amber-300">지워진 폴더 · 제거해 주세요</span>
                    : member.assetId)}
              </span>
              <span role="group" aria-label={`${memberNames[member.assetId] ?? member.assetId} 구분`} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={isRepresentative(member)}
                  className={isRepresentative(member) ? smallAddButton : smallOutlineButton}
                  disabled={saving}
                  onClick={() => setRepresentative(member.assetId)}
                >
                  대표
                </button>
                <button
                  type="button"
                  aria-pressed={!isRepresentative(member)}
                  className={!isRepresentative(member) ? smallAddButton : smallOutlineButton}
                  disabled={saving}
                  onClick={() => setSupporting(member.assetId)}
                >
                  서브
                </button>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                이야기 속 역할
                <input
                  className={inlineInput}
                  value={member.storyRole}
                  disabled={saving}
                  onChange={(event) => updateMember(member.assetId, "storyRole", event.target.value)}
                  onBlur={() => saveMember(member.assetId)}
                />
              </label>
              <button type="button" className={smallRemoveButton} disabled={saving} onClick={() => removeMember(member.assetId)}>
                제거
              </button>
            </li>
          ))}
        </ul>
      )}
      {cast && cast.length > 0 && cast.filter(isRepresentative).length !== 1 && (
        <p data-testid="cast-representative-hint" className="text-sm text-amber-300">
          {cast.some(isRepresentative)
            ? "대표로 지정된 캐릭터가 둘 이상입니다. 하나만 남겨 주세요 — 대본 AI는 대표를 한 명으로 봅니다."
            : "대표 캐릭터가 아직 없습니다. 이야기의 중심이 되는 캐릭터의 \"대표\"를 눌러 주세요."}
        </p>
      )}
      <form onSubmit={search} aria-label="캐릭터 폴더 검색" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          캐릭터 검색
          <input className={inlineInput} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit" className={smallOutlineButton} disabled={searchLoading}>
          검색
        </button>
      </form>
      {searchError && (
        <p role="alert" data-testid="cast-search-error" data-error-code={searchError.code} className="text-sm text-rose-400">
          {searchError.message}
        </p>
      )}
      {results && (
        <ul aria-label="캐릭터 검색 결과" className="space-y-1">
          {results.map((asset) => (
            <li key={asset.assetId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
              <span className="text-sm text-slate-200">{asset.displayName}</span>
              <button
                type="button"
                className={smallAddButton}
                disabled={saving || cast === null || cast.some((member) => member.assetId === asset.assetId)}
                onClick={() => addMember(asset)}
              >
                추가
              </button>
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && !searchLoading && (
        <p className="text-sm text-slate-400">캐릭터형 폴더가 없습니다. 이미지 보관함에서 캐릭터 폴더를 먼저 만들어 주세요.</p>
      )}
    </section>
  );
}

/**
 * Wizard-time link to another approved short project's final scene (that project's own last scene, not a fixed
 * Scene 6 — see docs/02_MIGRATION_PLAN.md's scene-count generalization) as this project's Story/Scene 1 continuity
 * source (Python's `lore_context.previous_scene_link`, opt-in only). Candidates are computed and re-validated
 * server-side on every save — this screen only ever sends a projectId, never the derived story text.
 */
function ContinuityEditor({ projectId }: { projectId: string }) {
  const [link, setLink] = useState<ShortProjectContinuityOption | null | undefined>(undefined);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [options, setOptions] = useState<ShortProjectContinuityOption[] | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProjectContinuity(projectId).then((response) => { if (!cancelled) setLink(response.link); })
      .catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function loadOptions(): Promise<void> {
    setOptionsLoading(true); setOptionsError(null);
    try {
      const response = await listProjectContinuityOptions(projectId);
      setOptions(response.options);
    } catch (caught) { setOptionsError(toDisplayError(caught)); }
    finally { setOptionsLoading(false); }
  }

  async function applyLink(sourceProjectId: string | null): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const response = await setProjectContinuity(projectId, { projectId: sourceProjectId });
      setLink(response.link);
      setOptions(null);
    } catch (caught) { setError(toDisplayError(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <section aria-label="이전 장면 연결" className={cardSection}>
      <SectionHeading>이전 장면 연결 <AutoSaveTag /></SectionHeading>
      {error && (
        <p role="alert" data-testid="continuity-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {link === undefined && !error && <Spinner label="불러오는 중..." />}
      {link !== undefined && (
        link ? (
          <p className="text-sm text-slate-300">
            {link.label} 연결됨. Story AI에는 마지막 상황, Image AI에는 마지막 장면을 Scene 1 연속성 Reference로 전달합니다.
          </p>
        ) : (
          <p className="text-sm text-slate-400">연결 안 함. 독립적인 새 이야기와 장면으로 시작합니다.</p>
        )
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={outlineButton} disabled={saving} onClick={() => void loadOptions()}>
          이전 프로젝트 선택
        </button>
        {link && (
          <button type="button" className={dangerOutlineButton} disabled={saving} onClick={() => void applyLink(null)}>
            연결 해제
          </button>
        )}
      </div>
      {optionsError && (
        <p role="alert" data-testid="continuity-options-error" data-error-code={optionsError.code} className="text-sm text-rose-400">
          {optionsError.message}
        </p>
      )}
      {options && options.length === 0 && !optionsLoading && (
        <p className="text-sm text-slate-400">연결 가능한 이미지 승인 완료 단기 프로젝트가 없습니다.</p>
      )}
      {options && options.length > 0 && (
        <ul aria-label="이전 프로젝트 선택 목록" className="space-y-1">
          {options.map((option) => (
            <li key={option.projectId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
              <span className="text-sm text-slate-200">{option.label}</span>
              <button type="button" className={smallAddButton} disabled={saving} onClick={() => void applyLink(option.projectId)}>
                선택
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ATMOSPHERE_ASSET_TYPES: AssetType[] = ["style", "general_reference", "background"];
const SCENE_REFERENCE_ASSET_TYPES: AssetType[] = ["background", "object", "style", "general_reference"];

/**
 * Wizard-time overall mood/color/lighting Assets and per-scene background/object/style/general reference Assets
 * with a required usage purpose (Python's `lore_context.atmosphere_asset_ids`/`scene_reference_assets`). Both
 * lists save together through one endpoint because the backend enforces mutual exclusion between them.
 */
function AssetReferenceEditor({ projectId }: { projectId: string }) {
  const [atmosphereAssetIds, setAtmosphereAssetIds] = useState<string[] | null>(null);
  const [sceneReferenceAssets, setSceneReferenceAssets] = useState<ShortProjectSceneReferenceAsset[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [atmosphereQuery, setAtmosphereQuery] = useState("");
  const [atmosphereResults, setAtmosphereResults] = useState<Asset[] | null>(null);
  const [atmosphereSearchError, setAtmosphereSearchError] = useState<{ code: string; message: string } | null>(null);

  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneResults, setSceneResults] = useState<Asset[] | null>(null);
  const [sceneSearchError, setSceneSearchError] = useState<{ code: string; message: string } | null>(null);
  const [scenePurposeDraft, setScenePurposeDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    getProjectAssetReferences(projectId).then((response) => {
      if (cancelled) return;
      setAtmosphereAssetIds(response.atmosphereAssetIds);
      setSceneReferenceAssets(response.sceneReferenceAssets);
    }).catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function search(query: string, types: AssetType[], setResults: (assets: Asset[]) => void, setSearchError: (error: { code: string; message: string } | null) => void): Promise<void> {
    setSearchError(null);
    try {
      const response = await listAssets({ query: query || undefined });
      setResults(response.assets.filter((asset) => !asset.isFolder && types.includes(asset.assetType)));
    } catch (caught) { setSearchError(toAssetDisplayError(caught)); }
  }

  async function persist(nextAtmosphere: string[], nextSceneReferences: ShortProjectSceneReferenceAsset[]): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const response = await updateProjectAssetReferences(projectId, { atmosphereAssetIds: nextAtmosphere, sceneReferenceAssets: nextSceneReferences });
      setAtmosphereAssetIds(response.atmosphereAssetIds);
      setSceneReferenceAssets(response.sceneReferenceAssets);
    } catch (caught) { setError(toDisplayError(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function addAtmosphere(asset: Asset): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets || atmosphereAssetIds.includes(asset.assetId)) return;
    void persist([...atmosphereAssetIds, asset.assetId], sceneReferenceAssets);
  }
  function removeAtmosphere(assetId: string): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    void persist(atmosphereAssetIds.filter((id) => id !== assetId), sceneReferenceAssets);
  }
  function addSceneReference(asset: Asset): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    const purpose = (scenePurposeDraft[asset.assetId] ?? "").trim();
    if (!purpose || sceneReferenceAssets.some((item) => item.assetId === asset.assetId)) return;
    void persist(atmosphereAssetIds, [...sceneReferenceAssets, { assetId: asset.assetId, purpose }]);
  }
  function removeSceneReference(assetId: string): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    void persist(atmosphereAssetIds, sceneReferenceAssets.filter((item) => item.assetId !== assetId));
  }
  function updateSceneReferencePurpose(assetId: string, purpose: string): void {
    if (!sceneReferenceAssets) return;
    setSceneReferenceAssets(sceneReferenceAssets.map((item) => item.assetId === assetId ? { ...item, purpose } : item));
  }
  function saveSceneReferencePurpose(assetId: string): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    const item = sceneReferenceAssets.find((entry) => entry.assetId === assetId);
    if (!item || !item.purpose.trim()) return;
    void persist(atmosphereAssetIds, sceneReferenceAssets);
  }

  const selectedIds = new Set([...(atmosphereAssetIds ?? []), ...(sceneReferenceAssets ?? []).map((item) => item.assetId)]);

  return (
    <section aria-label="분위기·장면 참고 이미지" className={cardSection}>
      <SectionHeading>분위기·장면 참고 이미지 <AutoSaveTag /></SectionHeading>
      <p className="text-xs text-slate-400">검색 결과가 없다면 이미지 보관함에서 배경·소품·스타일 이미지를 먼저 등록해 주세요.</p>
      {error && (
        <p role="alert" data-testid="asset-reference-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {atmosphereAssetIds === null && !error && <Spinner label="불러오는 중..." />}

      {atmosphereAssetIds && (
        <div aria-label="전체 분위기" className="space-y-2 rounded-xl border border-white/5 bg-slate-950/30 p-3.5">
          <h4 className="text-sm font-medium text-slate-300">전체 분위기</h4>
          {atmosphereAssetIds.length === 0 && <p className="text-sm text-slate-400">고른 분위기 이미지가 없습니다.</p>}
          {atmosphereAssetIds.length > 0 && (
            <ul aria-label="선택된 분위기 이미지 목록" className="space-y-1">
              {atmosphereAssetIds.map((assetId) => (
                <li key={assetId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2.5">
                  <span className="text-sm text-slate-200">{assetId}</span>
                  <button type="button" className={smallRemoveButton} disabled={saving} onClick={() => removeAtmosphere(assetId)}>
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => { event.preventDefault(); void search(atmosphereQuery, ATMOSPHERE_ASSET_TYPES, setAtmosphereResults, setAtmosphereSearchError); }}
            aria-label="분위기 이미지 검색"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              분위기 이미지 검색
              <input className={inlineInput} value={atmosphereQuery} onChange={(event) => setAtmosphereQuery(event.target.value)} />
            </label>
            <button type="submit" className={smallOutlineButton}>
              검색
            </button>
          </form>
          {atmosphereSearchError && (
            <p role="alert" data-testid="atmosphere-search-error" data-error-code={atmosphereSearchError.code} className="text-sm text-rose-400">
              {atmosphereSearchError.message}
            </p>
          )}
          {atmosphereResults && (
            <ul aria-label="분위기 이미지 검색 결과" className="space-y-1">
              {atmosphereResults.map((asset) => (
                <li key={asset.assetId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2.5">
                  <span className="text-sm text-slate-200">{asset.displayName}</span>
                  <button type="button" className={smallAddButton} disabled={saving || selectedIds.has(asset.assetId)} onClick={() => addAtmosphere(asset)}>
                    추가
                  </button>
                </li>
              ))}
            </ul>
          )}
          {atmosphereResults && atmosphereResults.length === 0 && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
        </div>
      )}

      {sceneReferenceAssets && (
        <div aria-label="장면 참고 이미지" className="space-y-2 rounded-xl border border-white/5 bg-slate-950/30 p-3.5">
          <h4 className="text-sm font-medium text-slate-300">장면 참고 이미지</h4>
          {sceneReferenceAssets.length === 0 && <p className="text-sm text-slate-400">고른 장면 참고 이미지가 없습니다.</p>}
          {sceneReferenceAssets.length > 0 && (
            <ul aria-label="고른 장면 참고 이미지 목록" className="space-y-2">
              {sceneReferenceAssets.map((item) => (
                <li key={item.assetId} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
                  <span className="text-sm font-medium text-slate-200">{item.assetId}</span>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400">
                    사용 목적
                    <input
                      className={inlineInput}
                      value={item.purpose}
                      disabled={saving}
                      onChange={(event) => updateSceneReferencePurpose(item.assetId, event.target.value)}
                      onBlur={() => saveSceneReferencePurpose(item.assetId)}
                    />
                  </label>
                  <button type="button" className={smallRemoveButton} disabled={saving} onClick={() => removeSceneReference(item.assetId)}>
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => { event.preventDefault(); void search(sceneQuery, SCENE_REFERENCE_ASSET_TYPES, setSceneResults, setSceneSearchError); }}
            aria-label="장면 참고 이미지 검색"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              장면 참고 이미지 검색
              <input className={inlineInput} value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} />
            </label>
            <button type="submit" className={smallOutlineButton}>
              검색
            </button>
          </form>
          {sceneSearchError && (
            <p role="alert" data-testid="scene-reference-search-error" data-error-code={sceneSearchError.code} className="text-sm text-rose-400">
              {sceneSearchError.message}
            </p>
          )}
          {sceneResults && (
            <ul aria-label="장면 참고 이미지 검색 결과" className="space-y-1">
              {sceneResults.map((asset) => (
                <li key={asset.assetId} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
                  <span className="text-sm text-slate-200">{asset.displayName}</span>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400">
                    사용 목적
                    <input
                      className={inlineInput}
                      value={scenePurposeDraft[asset.assetId] ?? ""}
                      onChange={(event) => setScenePurposeDraft({ ...scenePurposeDraft, [asset.assetId]: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className={smallAddButton}
                    disabled={saving || selectedIds.has(asset.assetId) || !(scenePurposeDraft[asset.assetId] ?? "").trim()}
                    onClick={() => addSceneReference(asset)}
                  >
                    추가
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sceneResults && sceneResults.length === 0 && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
        </div>
      )}
    </section>
  );
}

export function ShortProjectSettingsScreen({ projectId, onBack, justCreated = false }: Props) {
  const [state, setState] = useState<State>({ settings: null, loading: true, error: null, sceneCountChangeable: true, aspectRatioChangeable: true });
  const saving = useRef(false);
  const [characterOptions, setCharacterOptions] = useState<Asset[] | null>(null);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [characterOptionsLoading, setCharacterOptionsLoading] = useState(false);
  const [characterOptionsError, setCharacterOptionsError] = useState<{ code: string; message: string } | null>(null);
  /**
   * The lead the 등장 캐릭터 list names, lifted out of CastEditor.
   *
   * The server takes `castLeadName ?? settings.character` (story-prompt.service.ts), so exactly one of the two
   * controls on this screen is live at any moment and the screen has to say which. Held here because the field
   * that must say it sits in the form, while the answer is decided three sections below.
   */
  const [castLeadName, setCastLeadName] = useState<string | null>(null);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false);
  const [promptPreviewError, setPromptPreviewError] = useState<{ code: string; message: string } | null>(null);
  const promptPreviewRequest = useRef(0);
  const [justSaved, setJustSaved] = useState(false);
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!promptPreviewOpen || !state.settings) return;
    const settings = state.settings;
    if (!settings.projectName.trim() || !settings.topic.trim()) {
      setPromptPreview(null);
      setPromptPreviewError(null);
      setPromptPreviewLoading(false);
      return;
    }
    const requestId = ++promptPreviewRequest.current;
    setPromptPreviewLoading(true);
    // durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an
    // unsupported field if sent, so it is left out of the draft-preview request body here.
    const { durationSeconds: _draftDurationSeconds, ...settingsInput } = settings;
    const timer = setTimeout(() => {
      void createStoryPromptDraftPreview(projectId, settingsInput)
        .then((response) => {
          if (requestId !== promptPreviewRequest.current) return;
          setPromptPreview(response.prompt);
          setPromptPreviewError(null);
        })
        .catch((caught: unknown) => {
          if (requestId !== promptPreviewRequest.current) return;
          setPromptPreviewError(toStoryDisplayError(caught));
        })
        .finally(() => {
          if (requestId === promptPreviewRequest.current) setPromptPreviewLoading(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [promptPreviewOpen, state.settings, projectId]);

  useEffect(() => {
    let cancelled = false;
    getProjectSettings(projectId).then(({ settings, sceneCountChangeable, aspectRatioChangeable }) => {
      if (!cancelled) setState({ settings, loading: false, error: null, sceneCountChangeable, aspectRatioChangeable });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ settings: null, loading: false, error: toDisplayError(error), sceneCountChangeable: true, aspectRatioChangeable: true });
    });
    return () => { cancelled = true; };
  }, [projectId]);

  function setField<Key extends keyof ShortProjectSettings>(key: Key, value: ShortProjectSettings[Key]): void {
    setState((old) => old.settings ? { ...old, settings: { ...old.settings, [key]: value }, error: null } : old);
    setJustSaved(false);
  }

  async function openCharacterPicker(): Promise<void> {
    setCharacterPickerOpen((open) => !open);
    if (characterOptions !== null) return;
    setCharacterOptionsLoading(true);
    setCharacterOptionsError(null);
    try {
      const response = await listAssets({ assetType: "character" });
      setCharacterOptions(response.assets);
    } catch (caught) {
      setCharacterOptionsError(toAssetDisplayError(caught));
    } finally {
      setCharacterOptionsLoading(false);
    }
  }

  function pickCharacter(asset: Asset): void {
    setField("character", asset.displayName);
    setCharacterPickerOpen(false);
  }

  /**
   * Folders only — the same rule the 등장 캐릭터 list already follows. A loose drawing is one pose of a
   * character, not the character: picking "이배드_옆모습" as 대표 캐릭터 tells the story AI the protagonist is
   * a side view. The folder is the character; its children are the angles.
   *
   * `listAssets` returns the children too, and that is deliberate here — a Folder carries no image of its own
   * (`imageAvailable` is false for every Folder), so its 대표 이미지 has to be looked up by `thumbnailAssetId`
   * among those children. Without this the picker showed every folder as a grey "이미지 없음" tile.
   */
  const characterFolders = (characterOptions ?? []).filter((asset) => asset.isFolder);
  function folderThumbnail(folder: Asset): Asset | undefined {
    const children = (characterOptions ?? []).filter((asset) => asset.parentFolderId === folder.assetId);
    return children.find((child) => child.assetId === folder.thumbnailAssetId && child.imageAvailable)
      ?? children.find((child) => child.imageAvailable);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.settings || saving.current) return;
    // durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an
    // unsupported field if sent, so it is left out of the save request body here.
    const { durationSeconds: _formDurationSeconds, ...settingsInput } = state.settings;
    const settings = { ...settingsInput, projectName: state.settings.projectName.trim(), topic: state.settings.topic.trim() };
    if (!settings.projectName || !settings.topic) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "프로젝트 이름과 영상 주제는 필수입니다." } }));
      return;
    }
    saving.current = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      const response = await updateProjectSettings(projectId, { settings });
      // Keep the two lock flags: a settings save cannot change them (only generating a Story or images can),
      // and the response does not carry them. Replacing the whole state here dropped both, which typechecked
      // as an error and would have shown the locked fields as editable again right after a save.
      setState((old) => ({ ...old, settings: response.settings, loading: false, error: null }));
      setJustSaved(true);
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
      justSavedTimer.current = setTimeout(() => setJustSaved(false), 4000);
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: toDisplayError(error) }));
    } finally { saving.current = false; }
  }

  if (state.loading && !state.settings) return <Spinner label="불러오는 중…" className="mt-8" />;
  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        {justCreated ? "프로젝트로 이동" : "프로젝트로 돌아가기"}
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        프로젝트 설정
      </h2>
      {justCreated && (
        <p className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200" data-testid="just-created-notice">
          프로젝트가 생성되었습니다. 대본을 생성하기 전에 아래에서 장르·분위기와 등장 캐릭터, 참고 이미지, 이전 장면 연결을
          설정해 주세요 — 전부 선택 사항이며 나중에 다시 와서 바꿀 수도 있습니다.
        </p>
      )}
      {state.error && !state.settings && (
        <p className="text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}
      {state.settings && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <form className="grid gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 md:grid-cols-2" onSubmit={submit} noValidate>
          <Field label="프로젝트 이름" value={state.settings.projectName} onChange={(value) => setField("projectName", value)} />
          <Field label="영상 주제" value={state.settings.topic} onChange={(value) => setField("topic", value)} />
          <Field label="장르" value={state.settings.genre} onChange={(value) => setField("genre", value)} />
          <Field label="분위기" value={state.settings.mood} onChange={(value) => setField("mood", value)} />
          {/* The one place two controls on this screen answer the same question. The server resolves it as
              `castLeadName ?? settings.character`, so a lead in 등장 캐릭터 below silently overrides whatever is
              typed here — a person could name a character, mark a folder 대표, and never learn the typed name
              was dropped. Disabled rather than hidden: removing the lead below makes this field live again,
              and a field that vanishes and returns is harder to trust than one that explains itself. */}
          <label className="block text-sm text-slate-300">
            대표 캐릭터
            <input
              aria-label="대표 캐릭터"
              className={fieldClassName}
              value={castLeadName ?? state.settings.character}
              disabled={castLeadName !== null}
              onChange={(event) => setField("character", event.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500" data-testid="character-source">
              {castLeadName !== null
                ? <>아래 <span className="text-slate-400">등장 캐릭터</span>에서 고른 대표를 씁니다. 바꾸려면 거기서 고쳐 주세요.</>
                : "등장 캐릭터에서 대표를 고르면 그 폴더 이름이 대신 쓰입니다."}
            </span>
          </label>
          <div className="text-sm text-slate-300 md:col-span-2">
            <button type="button" className={smallOutlineButton} onClick={() => void openCharacterPicker()}>
              {characterPickerOpen ? "폴더에서 선택 닫기" : "폴더에서 캐릭터 선택"}
            </button>
            {characterPickerOpen && (
              <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">
                  캐릭터 <strong className="text-slate-300">폴더</strong>를 고릅니다. 폴더 안의 정면·옆모습·뒷모습이 함께 전달되므로,
                  낱장 이미지 하나를 고를 때보다 캐릭터가 일관되게 나옵니다.
                </p>
                {characterOptionsLoading && <Spinner label="캐릭터 폴더를 불러오는 중..." />}
                {characterOptionsError && (
                  <p role="alert" data-testid="character-picker-error" data-error-code={characterOptionsError.code} className="text-sm text-rose-400">
                    {characterOptionsError.message}
                  </p>
                )}
                {characterOptions && characterFolders.length === 0 && !characterOptionsLoading && (
                  <p className="text-sm text-slate-400">
                    이미지 보관함에 캐릭터 폴더가 없습니다. 보관함에서 캐릭터 폴더를 먼저 만들고 그 안에 이미지를 넣어 주세요.
                  </p>
                )}
                {characterFolders.length > 0 && (
                  <ul aria-label="캐릭터 폴더 선택" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {characterFolders.map((folder) => {
                      const thumbnail = folderThumbnail(folder);
                      return (
                        <li key={folder.assetId}>
                          <button
                            type="button"
                            className="w-full rounded-lg border border-white/10 bg-slate-900/70 p-1.5 text-left hover:border-violet-400/40"
                            onClick={() => pickCharacter(folder)}
                          >
                            {thumbnail?.contentUrl ? (
                              <img src={thumbnail.contentUrl} alt="" className="h-16 w-full rounded object-cover" />
                            ) : (
                              <span className="flex h-16 w-full items-center justify-center rounded bg-slate-950/40 text-xs text-slate-500">이미지 없음</span>
                            )}
                            <span className="mt-1 block truncate text-xs text-slate-200">{folder.displayName}</span>
                            <span className="block text-[11px] text-slate-500">이미지 {folder.childAssetIds.length}장</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
          <label className="block text-sm text-slate-300">
            장면 수
            <input
              type="number"
              data-testid="settings-scene-count"
              min={MIN_SCENE_COUNT}
              max={MAX_SCENE_COUNT}
              className={fieldClassName}
              value={state.settings.sceneCount}
              disabled={!state.sceneCountChangeable}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isInteger(parsed)) return;
                const sceneCount = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, parsed));
                setField("sceneCount", sceneCount);
                setField("durationSeconds", sceneCount * state.settings!.clipDurationSeconds);
              }}
            />
          </label>
          {/* Said before the field is touched, not after a rejected save. The refusal is knowable the moment
              this screen opens, and the last thing a person needs is to type a number, press save, and only
              then be told it was never going to work. The field is disabled as well as explained — a notice
              above a working field is just a field with a notice on it. */}
          {!state.sceneCountChangeable && (
            <p data-testid="settings-scene-count-locked" className="text-xs text-amber-300">
              이야기를 이미 만들어서 장면 수는 바꿀 수 없습니다. 바꾸려면 이야기를 다시 만들어야 합니다.
            </p>
          )}
          <label className="block text-sm text-slate-300">
            클립 길이(초)
            <select
              className={fieldClassName}
              value={state.settings.clipDurationSeconds}
              onChange={(event) => {
                const clipDurationSeconds = Number(event.target.value);
                setField("clipDurationSeconds", clipDurationSeconds);
                setField("durationSeconds", state.settings!.sceneCount * clipDurationSeconds);
              }}
            >
              {RUNWAY_CLIP_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>{duration}초</option>
              ))}
            </select>
          </label>
          <Field label="전체 줄거리" value={state.settings.fullStory} onChange={(value) => setField("fullStory", value)} multiline />
          <Field label="세계관" value={state.settings.lore} onChange={(value) => setField("lore", value)} multiline />
          <Field label="시각 스타일" value={state.settings.styleNotes.visualStyle ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, visualStyle: value })} />
          <Field label="색감" value={state.settings.styleNotes.color ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, color: value })} />
          <Field label="조명" value={state.settings.styleNotes.lighting ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, lighting: value })} />
          <Field label="카메라 느낌" value={state.settings.styleNotes.camera ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, camera: value })} />
          <Field label="대사 스타일" value={state.settings.styleNotes.dialogue ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, dialogue: value })} />
          <Field label="피할 요소" value={state.settings.styleNotes.avoid ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, avoid: value })} />
          <AspectField value={state.settings.styleNotes.aspect ?? ""} changeable={state.aspectRatioChangeable} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, aspect: value })} />
          <Field label="추가 지시사항" value={state.settings.additionalNotes} onChange={(value) => setField("additionalNotes", value)} multiline />
          <div className="md:col-span-2 space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-3.5">
            <p className="text-sm font-semibold text-slate-200">내레이션</p>
            {/* Matched to the long project's wording after it was cut there — the same feature was explained
                at two lengths on two screens. */}
            <p className="text-xs leading-relaxed text-slate-400">장면마다 읽어줄 문장이 대본에 함께 들어갑니다. 인물이 말하는 게 아니라 읽어주는 방식입니다.</p>
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                data-testid="settings-narration-enabled"
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-violet-500"
                checked={state.settings.narrationEnabled}
                onChange={(event) => setField("narrationEnabled", event.target.checked)}
              />
              <span>
                음성 넣기
                <span className="mt-1 block text-xs text-slate-400">실제 목소리로 만들어 영상에 입힙니다. 장면마다 비용이 듭니다.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                data-testid="settings-subtitles-enabled"
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-violet-500"
                checked={state.settings.subtitlesEnabled}
                onChange={(event) => setField("subtitlesEnabled", event.target.checked)}
              />
              <span>
                자막 넣기
                <span className="mt-1 block text-xs text-slate-400">같은 문장을 글자로 얹습니다. <span className="text-slate-300">비용 없음.</span></span>
              </span>
            </label>
          </div>
          <p className="text-sm text-slate-400 md:col-span-2">
            예상 총 영상 길이: {state.settings.sceneCount * state.settings.clipDurationSeconds}초 ({state.settings.sceneCount}장면 × {state.settings.clipDurationSeconds}초)
          </p>
          {state.error && (
            <p className="text-sm text-rose-400 md:col-span-2" role="alert" data-error-code={state.error.code}>
              {state.error.message}
            </p>
          )}
          {justSaved && !state.error && (
            <p
              role="status"
              data-testid="settings-saved-notice"
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2 text-sm text-emerald-300 md:col-span-2"
            >
              설정이 저장되었습니다.
            </p>
          )}
          {/* Said here rather than in the page footer: this is the box the rule is about, and this is where
              someone is looking when they decide whether they are done. */}
          <p className="text-xs text-slate-500 md:col-span-2">이 상자의 내용은 <span className="text-slate-400">설정 저장</span>을 눌러야 저장됩니다.</p>
          <button type="submit" disabled={state.loading} className={`${primaryButton} md:col-span-2`}>
            {state.loading ? "저장 중…" : "설정 저장"}
          </button>
        </form>
        <aside aria-label="대본 프롬프트 실시간 미리보기" className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-4 lg:sticky lg:top-4">
          <button type="button" className={smallOutlineButton} onClick={() => setPromptPreviewOpen((open) => !open)}>
            {promptPreviewOpen ? "프롬프트 미리보기 닫기" : "프롬프트 미리보기 보기"}
          </button>
          {promptPreviewOpen && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">입력을 멈추면 잠시 후 실제 대본 AI에 보낼 프롬프트가 여기에 표시됩니다. 저장하지 않아도 됩니다.</p>
              {promptPreviewLoading && <Spinner label="미리보기 갱신 중..." />}
              {!promptPreviewLoading && promptPreviewError && (
                <p role="alert" data-testid="story-prompt-draft-preview-error" data-error-code={promptPreviewError.code} className="text-xs text-rose-400">
                  {promptPreviewError.message}
                </p>
              )}
              {!promptPreviewLoading && !promptPreviewError && promptPreview && (
                <>
                  {/* Length is part of what the user is judging here: a prompt that grew past what the model
                      handles well is not visible from reading it, and this is the screen where the inputs that
                      made it long can still be trimmed. Counted in code points, not UTF-16 units, so an emoji
                      or a surrogate pair counts once — the same way a person counts characters. */}
                  <p data-testid="story-prompt-draft-preview-length" className="text-xs tabular-nums text-slate-400">
                    {[...promptPreview].length.toLocaleString("ko-KR")}자 · 줄 {promptPreview.split("\n").length.toLocaleString("ko-KR")}
                  </p>
                  <pre data-testid="story-prompt-draft-preview" className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300">
                    {promptPreview}
                  </pre>
                </>
              )}
              {!promptPreviewLoading && !promptPreviewError && !promptPreview && (
                <p className="text-xs text-slate-500">프로젝트 이름과 영상 주제를 채우면 미리보기가 표시됩니다.</p>
              )}
            </div>
          )}
        </aside>
        </div>
      )}
      {state.settings && <CastEditor projectId={projectId} onLeadNameChange={setCastLeadName} />}
      {state.settings && <AssetReferenceEditor projectId={projectId} />}
      {state.settings && <ContinuityEditor projectId={projectId} />}
      {/* The page used to end here with nothing — the only way out was scrolling back past four sections to the
          돌아가기 at the top. Worse, the finish button existed only right after creation, so anyone reopening
          settings later hit a dead end. The bar now always renders; only its wording changes.
          The note is not filler: the three sections above save on every click, the form at the top does not. */}
      {state.settings && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-4">
          {justCreated ? (
            <button type="button" data-testid="finish-setup-button" className={primaryButton} onClick={onBack}>
              설정 완료 · 계속 진행하기
            </button>
          ) : (
            <button type="button" data-testid="settings-done-button" className={primaryButton} onClick={onBack}>
              프로젝트로 돌아가기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
